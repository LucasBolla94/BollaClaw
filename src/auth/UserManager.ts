import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================
// UserManager — Dynamic user approval system
// ============================================================
// Instead of static TELEGRAM_ALLOWED_USER_IDS, users are approved
// via invite codes. When an unknown user messages the bot:
//   1. Bot generates a 6-char code
//   2. Bot replies: "Peça ao admin: bollaclaw add <CODE>"
//   3. Admin runs `bollaclaw add <CODE>` on the server
//   4. User is added to approved list
// ============================================================

export interface ApprovedUser {
  telegramId: string;
  name?: string;
  approvedAt: string;
  approvedBy: string; // 'admin' | 'seed' | telegram ID of who approved
}

export interface PendingApproval {
  code: string;
  telegramId: string;
  telegramName: string;
  requestedAt: string;
  expiresAt: string;
}

interface UserStore {
  admins: string[];             // Telegram IDs that can approve others
  approved: ApprovedUser[];
  pending: PendingApproval[];
}

const CODE_EXPIRY_HOURS = 48;
const CODE_LENGTH = 6;

export class UserManager {
  private storePath: string;
  private store: UserStore;

  constructor(dataDir?: string) {
    const dir = dataDir ?? path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.storePath = path.join(dir, 'users.json');
    this.store = this.load();
  }

  // ── Load / Save ──────────────────────────────────────────

  private load(): UserStore {
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = fs.readFileSync(this.storePath, 'utf-8');
        return JSON.parse(raw) as UserStore;
      } catch {
        return this.defaultStore();
      }
    }
    return this.defaultStore();
  }

  private defaultStore(): UserStore {
    return { admins: [], approved: [], pending: [] };
  }

  private save(): void {
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  // ── Seed from .env (migration from old TELEGRAM_ALLOWED_USER_IDS) ──

  seedFromEnv(allowedIds: string[]): void {
    for (const id of allowedIds) {
      if (!id) continue;
      if (!this.isApproved(id)) {
        this.store.approved.push({
          telegramId: id,
          approvedAt: new Date().toISOString(),
          approvedBy: 'seed',
        });
      }
      // First seeded user becomes admin
      if (!this.store.admins.includes(id)) {
        this.store.admins.push(id);
      }
    }
    this.save();
  }

  // ── Check if user is approved ────────────────────────────

  isApproved(telegramId: string): boolean {
    return this.store.approved.some((u) => u.telegramId === telegramId);
  }

  isAdmin(telegramId: string): boolean {
    return this.store.admins.includes(telegramId);
  }

  // ── Request access (generates code) ──────────────────────

  requestAccess(telegramId: string, telegramName: string): PendingApproval {
    // Remove expired pending entries
    this.cleanExpired();

    // Check if already pending
    const existing = this.store.pending.find((p) => p.telegramId === telegramId);
    if (existing) {
      return existing;
    }

    const code = this.generateCode();
    const pending: PendingApproval = {
      code,
      telegramId,
      telegramName,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + CODE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
    };

    this.store.pending.push(pending);
    this.save();

    return pending;
  }

  // ── Approve by code (called from CLI) ────────────────────

  approveByCode(code: string): { success: boolean; user?: ApprovedUser; error?: string } {
    this.cleanExpired();

    const idx = this.store.pending.findIndex(
      (p) => p.code.toLowerCase() === code.toLowerCase()
    );

    if (idx === -1) {
      return { success: false, error: `Código "${code}" não encontrado ou expirado.` };
    }

    const pending = this.store.pending[idx];
    const approved: ApprovedUser = {
      telegramId: pending.telegramId,
      name: pending.telegramName,
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin',
    };

    this.store.approved.push(approved);
    this.store.pending.splice(idx, 1);
    this.save();

    return { success: true, user: approved };
  }

  // ── Approve by Telegram ID directly ──────────────────────

  approveById(telegramId: string, approvedBy: string = 'admin'): ApprovedUser {
    if (this.isApproved(telegramId)) {
      return this.store.approved.find((u) => u.telegramId === telegramId)!;
    }

    const approved: ApprovedUser = {
      telegramId,
      approvedAt: new Date().toISOString(),
      approvedBy,
    };

    this.store.approved.push(approved);
    // Remove from pending if exists
    this.store.pending = this.store.pending.filter((p) => p.telegramId !== telegramId);
    this.save();

    return approved;
  }

  // ── Remove user ──────────────────────────────────────────

  removeUser(telegramId: string): boolean {
    const before = this.store.approved.length;
    this.store.approved = this.store.approved.filter((u) => u.telegramId !== telegramId);
    this.store.admins = this.store.admins.filter((id) => id !== telegramId);
    this.save();
    return this.store.approved.length < before;
  }

  // ── Promote to admin ─────────────────────────────────────

  promoteAdmin(telegramId: string): boolean {
    if (!this.isApproved(telegramId)) return false;
    if (this.store.admins.includes(telegramId)) return false;
    this.store.admins.push(telegramId);
    this.save();
    return true;
  }

  // ── List users ───────────────────────────────────────────

  listApproved(): ApprovedUser[] {
    return [...this.store.approved];
  }

  listPending(): PendingApproval[] {
    this.cleanExpired();
    return [...this.store.pending];
  }

  listAdmins(): string[] {
    return [...this.store.admins];
  }

  // ── Helpers ──────────────────────────────────────────────

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous: 0/O, 1/I
    let code = '';
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  private cleanExpired(): void {
    const now = Date.now();
    const before = this.store.pending.length;
    this.store.pending = this.store.pending.filter(
      (p) => new Date(p.expiresAt).getTime() > now
    );
    if (this.store.pending.length < before) {
      this.save();
    }
  }
}
