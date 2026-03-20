#!/usr/bin/env node
// ============================================================
// BollaClaw CLI — Server-side command interface
// ============================================================

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import * as crypto from 'crypto';

// Load .env from the bollaclaw directory
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import { UserManager } from '../auth/UserManager';
import { ModelManager, ModelInfo } from '../models/ModelManager';
import { execSync } from 'child_process';

// ── Colors ───────────────────────────────────────────────────
const R = '\x1b[0;31m';
const G = '\x1b[0;32m';
const Y = '\x1b[1;33m';
const B = '\x1b[0;34m';
const M = '\x1b[0;35m';
const C = '\x1b[0;36m';
const W = '\x1b[1;37m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const UL = '\x1b[4m';
const NC = '\x1b[0m';

function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  switch (command) {
    case 'add':
      return cmdAdd(args.slice(1));
    case 'users':
    case 'list':
      return cmdListUsers();
    case 'pending':
      return cmdListPending();
    case 'remove':
    case 'rm':
      return cmdRemove(args.slice(1));
    case 'admin':
      return cmdPromoteAdmin(args.slice(1));
    case 'status':
      return cmdStatus();
    case 'restart':
      return cmdRestart();
    case 'logs':
      return cmdLogs();
    case 'stop':
      return cmdStop();
    case 'start':
      return cmdStart();
    case 'models':
      return cmdModels(args.slice(1));
    case 'update':
      return cmdUpdate(args.slice(1));
    case 'soul':
      return cmdSoul(args.slice(1));
    case 'web':
      return cmdWeb();
    case 'change':
      return cmdChangePassword(args.slice(1));
    default:
      console.log(`\n  ${R}✘${NC} Comando desconhecido: ${BOLD}${command}${NC}`);
      console.log(`  Use ${C}bollaclaw help${NC} para ver os comandos.\n`);
      process.exit(1);
  }
}

// ── User Management ──────────────────────────────────────────

function getUserManager(): UserManager {
  return new UserManager(path.join(projectRoot, 'data'));
}

function cmdAdd(args: string[]) {
  const code = args[0];
  if (!code) {
    console.log(`\n  ${R}✘${NC} Uso: ${C}bollaclaw add <CÓDIGO>${NC}`);
    console.log(`  ${DIM}O código aparece quando um usuário novo envia mensagem ao bot.${NC}\n`);
    process.exit(1);
  }

  const um = getUserManager();
  const result = um.approveByCode(code);
  if (result.success && result.user) {
    console.log(`\n  ${G}✔${NC} Usuário aprovado!\n`);
    console.log(`  ${DIM}├─${NC} Telegram ID: ${C}${result.user.telegramId}${NC}`);
    if (result.user.name) {
      console.log(`  ${DIM}└─${NC} Nome: ${BOLD}${result.user.name}${NC}`);
    }
    console.log(`\n  ${DIM}O usuário já pode interagir com o bot.${NC}\n`);
  } else {
    console.log(`\n  ${R}✘${NC} ${result.error}\n`);
    const pending = um.listPending();
    if (pending.length > 0) {
      console.log(`  ${Y}Códigos pendentes:${NC}`);
      for (const p of pending) {
        console.log(`  ${DIM}├─${NC} ${BOLD}${p.code}${NC} — ${p.telegramName} ${DIM}(${p.telegramId})${NC}`);
      }
      console.log('');
    }
    process.exit(1);
  }
}

function cmdListUsers() {
  const um = getUserManager();
  const users = um.listApproved();
  const admins = um.listAdmins();

  if (users.length === 0) {
    console.log(`\n  ${Y}Nenhum usuário aprovado.${NC}\n`);
    return;
  }

  console.log(`\n  ${W}Usuários aprovados${NC} ${DIM}(${users.length})${NC}\n`);
  for (const u of users) {
    const isAdmin = admins.includes(u.telegramId);
    const badge = isAdmin ? ` ${Y}★ ADMIN${NC}` : '';
    const name = u.name ? ` ${DIM}(${u.name})${NC}` : '';
    console.log(`  ${DIM}├─${NC} ${C}${u.telegramId}${NC}${name}${badge} ${DIM}— ${u.approvedAt.split('T')[0]}${NC}`);
  }
  console.log('');
}

function cmdListPending() {
  const um = getUserManager();
  const pending = um.listPending();

  if (pending.length === 0) {
    console.log(`\n  ${G}✔${NC} Nenhuma solicitação pendente.\n`);
    return;
  }

  console.log(`\n  ${W}Solicitações pendentes${NC} ${DIM}(${pending.length})${NC}\n`);
  for (const p of pending) {
    const expires = new Date(p.expiresAt).toLocaleString('pt-BR');
    console.log(`  ${DIM}├─${NC} ${BOLD}${p.code}${NC} — ${p.telegramName} ${DIM}(${p.telegramId})${NC}`);
    console.log(`  ${DIM}│  ${NC}${DIM}Expira: ${expires}${NC}`);
    console.log(`  ${DIM}│  ${NC}→ ${C}bollaclaw add ${p.code}${NC}`);
    console.log(`  ${DIM}│${NC}`);
  }
  console.log('');
}

function cmdRemove(args: string[]) {
  const telegramId = args[0];
  if (!telegramId) {
    console.log(`\n  ${R}✘${NC} Uso: ${C}bollaclaw remove <TELEGRAM_ID>${NC}\n`);
    process.exit(1);
  }

  const um = getUserManager();
  if (um.removeUser(telegramId)) {
    console.log(`\n  ${G}✔${NC} Usuário ${C}${telegramId}${NC} removido.\n`);
  } else {
    console.log(`\n  ${R}✘${NC} Usuário ${telegramId} não encontrado.\n`);
    process.exit(1);
  }
}

function cmdPromoteAdmin(args: string[]) {
  const telegramId = args[0];
  if (!telegramId) {
    console.log(`\n  ${R}✘${NC} Uso: ${C}bollaclaw admin <TELEGRAM_ID>${NC}\n`);
    process.exit(1);
  }

  const um = getUserManager();
  if (um.promoteAdmin(telegramId)) {
    console.log(`\n  ${G}✔${NC} Usuário ${C}${telegramId}${NC} promovido a ${Y}★ ADMIN${NC}\n`);
  } else {
    console.log(`\n  ${R}✘${NC} Usuário não encontrado ou já é admin.\n`);
    process.exit(1);
  }
}

// ── Service Management ───────────────────────────────────────

function cmdStatus() {
  try {
    const output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf-8' });
    const processes = JSON.parse(output);
    const bc = processes.find((p: any) => p.name === 'bollaclaw');

    if (bc) {
      const status = bc.pm2_env?.status ?? 'unknown';
      const statusColor = status === 'online' ? G : R;
      const statusIcon = status === 'online' ? '●' : '○';
      const uptime = bc.pm2_env?.pm_uptime
        ? formatUptime(Date.now() - bc.pm2_env.pm_uptime)
        : 'N/A';
      const memory = bc.monit?.memory
        ? `${Math.round(bc.monit.memory / 1024 / 1024)}MB`
        : 'N/A';
      const cpu = bc.monit?.cpu ?? 'N/A';
      const restarts = bc.pm2_env?.restart_time ?? 0;

      // Current model
      const mm = new ModelManager(path.join(projectRoot, 'data'));
      const current = mm.getCurrentModel(path.join(projectRoot, '.env'));

      console.log('');
      console.log(`  ${W}BollaClaw Status${NC}`);
      console.log(`  ${DIM}${'─'.repeat(40)}${NC}`);
      console.log(`  ${DIM}├─${NC} Status     ${statusColor}${statusIcon} ${status}${NC}`);
      console.log(`  ${DIM}├─${NC} Uptime     ${BOLD}${uptime}${NC}`);
      console.log(`  ${DIM}├─${NC} Memória    ${memory}`);
      console.log(`  ${DIM}├─${NC} CPU        ${cpu}%`);
      console.log(`  ${DIM}├─${NC} Restarts   ${restarts}`);
      console.log(`  ${DIM}├─${NC} PID        ${bc.pid}`);
      if (current) {
        console.log(`  ${DIM}├─${NC} Provider   ${C}${current.provider}${NC}`);
        console.log(`  ${DIM}└─${NC} Modelo     ${M}${current.model}${NC}`);
      } else {
        console.log(`  ${DIM}└─${NC} Config     ${Y}.env não encontrado${NC}`);
      }
      console.log('');
    } else {
      console.log(`\n  ${Y}○${NC} BollaClaw não está rodando via PM2.`);
      console.log(`  Use ${C}bollaclaw start${NC} para iniciar.\n`);
    }
  } catch {
    console.log(`\n  ${R}✘${NC} PM2 não encontrado ou não acessível.\n`);
  }
}

function cmdRestart() {
  console.log(`\n  ${C}↻${NC} Reiniciando BollaClaw...`);
  try {
    execSync('pm2 restart bollaclaw', { stdio: 'pipe' });
    console.log(`  ${G}✔${NC} Reiniciado!\n`);
  } catch {
    console.log(`  ${R}✘${NC} Falha ao reiniciar.`);
    console.log(`  Use ${C}bollaclaw start${NC} para iniciar.\n`);
  }
}

function cmdStop() {
  console.log(`\n  ${Y}■${NC} Parando BollaClaw...`);
  try {
    execSync('pm2 stop bollaclaw', { stdio: 'pipe' });
    console.log(`  ${G}✔${NC} Parado.\n`);
  } catch {
    console.log(`  ${R}✘${NC} Falha ao parar.\n`);
  }
}

function cmdStart() {
  console.log(`\n  ${G}▶${NC} Iniciando BollaClaw...`);
  try {
    execSync(`pm2 start ${path.join(projectRoot, 'ecosystem.config.js')}`, { stdio: 'pipe' });
    console.log(`  ${G}✔${NC} Iniciado!\n`);
  } catch {
    console.log(`  ${R}✘${NC} Falha ao iniciar.\n`);
  }
}

function cmdLogs() {
  try {
    execSync('pm2 logs bollaclaw --lines 50', { stdio: 'inherit' });
  } catch {
    console.log(`\n  ${R}✘${NC} Falha ao exibir logs.\n`);
  }
}

// ── Models Command ───────────────────────────────────────────

async function cmdModels(args: string[]) {
  const mm = new ModelManager(path.join(projectRoot, 'data'));
  const envPath = path.join(projectRoot, '.env');
  const current = mm.getCurrentModel(envPath);
  const subCmd = args[0]?.toLowerCase();

  if (!current) {
    console.log(`\n  ${R}✘${NC} Arquivo .env não encontrado. Execute ${C}bollaclaw${NC} no diretório correto.\n`);
    process.exit(1);
  }

  const provider = current.provider;

  // Show current model info
  console.log('');
  console.log(`  ${W}Modelos de IA${NC}`);
  console.log(`  ${DIM}${'─'.repeat(50)}${NC}`);
  console.log(`  ${DIM}├─${NC} Provider atual: ${C}${provider}${NC}`);
  console.log(`  ${DIM}└─${NC} Modelo atual:   ${M}${current.model}${NC}`);
  console.log('');

  // Sub-commands
  if (subCmd === 'set' || subCmd === 'use') {
    const modelId = args[1];
    if (!modelId) {
      console.log(`  ${R}✘${NC} Uso: ${C}bollaclaw models set <MODEL_ID>${NC}\n`);
      process.exit(1);
    }
    if (mm.changeModel(envPath, modelId)) {
      console.log(`  ${G}✔${NC} Modelo alterado para: ${M}${modelId}${NC}`);
      console.log(`  ${DIM}Execute ${C}bollaclaw restart${NC}${DIM} para aplicar.${NC}\n`);
    } else {
      console.log(`  ${R}✘${NC} Falha ao alterar modelo.\n`);
    }
    return;
  }

  if (subCmd === 'fetch' && provider === 'openrouter') {
    console.log(`  ${C}⟳${NC} Buscando catálogo completo do OpenRouter...\n`);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.log(`  ${R}✘${NC} OPENROUTER_API_KEY não configurada no .env\n`);
      process.exit(1);
    }
    try {
      const models = await mm.fetchOpenRouterModels(apiKey);
      const freeModels = models.filter(m => m.isFree);
      const paidModels = models.filter(m => !m.isFree);

      console.log(`  ${G}✔${NC} ${BOLD}${models.length}${NC} modelos encontrados ${DIM}(${freeModels.length} grátis, ${paidModels.length} pagos)${NC}\n`);

      if (freeModels.length > 0) {
        console.log(`  ${G}═══ MODELOS GRÁTIS ═══${NC}\n`);
        printModelTable(freeModels.slice(0, 20));
      }

      console.log(`  ${M}═══ TOP MODELOS PAGOS ═══${NC}\n`);
      printModelTable(paidModels.slice(0, 20));

      console.log(`  ${DIM}Cache salvo em data/. Para atualizar: ${C}bollaclaw models fetch${NC}\n`);
    } catch (err) {
      console.log(`  ${R}✘${NC} Erro ao buscar modelos: ${err}\n`);
    }
    return;
  }

  // Default: show available models
  let models: ModelInfo[];

  if (provider === 'openrouter') {
    // Check cache first
    const cached = mm['readCache']('openrouter');
    if (cached) {
      models = cached.models;
      console.log(`  ${DIM}(cache de ${new Date(cached.fetchedAt).toLocaleString('pt-BR')})${NC}`);
    } else {
      models = mm.getCuratedOpenRouterModels();
      console.log(`  ${DIM}(lista curada — use ${C}bollaclaw models fetch${NC}${DIM} para catálogo completo)${NC}`);
    }
    console.log('');

    const freeModels = models.filter(m => m.isFree);
    const paidModels = models.filter(m => !m.isFree);

    if (freeModels.length > 0) {
      console.log(`  ${G}${BOLD}★ GRÁTIS${NC}\n`);
      printModelTable(freeModels);
      console.log('');
    }

    console.log(`  ${M}${BOLD}★ PAGOS${NC}\n`);
    printModelTable(paidModels);
  } else {
    models = mm.getStaticModels(provider);
    if (models.length === 0) {
      console.log(`  ${Y}Nenhum modelo pré-definido para ${provider}.${NC}`);
      console.log(`  ${DIM}Configure LLM_MODEL manualmente no .env${NC}\n`);
      return;
    }
    printModelTable(models);
  }

  console.log('');
  console.log(`  ${W}Para trocar modelo:${NC}`);
  console.log(`  ${C}bollaclaw models set <MODEL_ID>${NC}`);
  console.log(`  ${DIM}Exemplo: bollaclaw models set ${models[0]?.id || 'model-id'}${NC}`);
  console.log('');
}

function printModelTable(models: ModelInfo[]) {
  // Header
  console.log(`  ${DIM}  %-42s %-8s %-12s %-12s${NC}`.replace(/%/g, ''));
  console.log(`  ${DIM}${BOLD}  ${'ID'.padEnd(42)} ${'Context'.padEnd(8)} ${'Prompt/M'.padEnd(12)} Completion/M${NC}`);
  console.log(`  ${DIM}  ${'─'.repeat(42)} ${'─'.repeat(8)} ${'─'.repeat(12)} ${'─'.repeat(12)}${NC}`);

  for (const m of models) {
    const id = m.id.length > 40 ? m.id.substring(0, 37) + '...' : m.id;
    const ctx = ModelManager.formatContext(m.contextLength);
    const pp = m.isFree ? `${G}GRÁTIS${NC}` : `${DIM}$${m.pricingPrompt.toFixed(2)}${NC}`;
    const cp = m.isFree ? `${G}GRÁTIS${NC}` : `${DIM}$${m.pricingCompletion.toFixed(2)}${NC}`;
    const desc = m.description ? ` ${DIM}${m.description}${NC}` : '';
    const isActive = m.id === process.env.LLM_MODEL ? ` ${G}← ativo${NC}` : '';

    console.log(`  ${C}  ${id.padEnd(42)}${NC} ${BOLD}${ctx.padEnd(8)}${NC} ${pp.padEnd(23)} ${cp}${isActive}`);
    if (desc) console.log(`  ${DIM}  ${' '.repeat(42)} ${m.description}${NC}`);
  }
}

// ── Update v2 — Bulletproof CLI Update ──────────────────────

const UPDATE_LOCK = '.update.lock';
const UPDATE_BACKUP = '.update-backup';

function cliGit(args: string): string {
  return execSync(`git ${args}`, { cwd: projectRoot, encoding: 'utf-8', timeout: 30_000 });
}

function cliExec(cmd: string, timeoutMs = 180_000): string {
  return execSync(cmd, { cwd: projectRoot, encoding: 'utf-8', timeout: timeoutMs });
}

function isUpdateLocked(): boolean {
  const lockPath = path.join(projectRoot, UPDATE_LOCK);
  if (!fs.existsSync(lockPath)) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const age = Date.now() - new Date(lock.startedAt).getTime();
    if (age > 10 * 60 * 1000) {
      fs.unlinkSync(lockPath);
      return false;
    }
    return true;
  } catch {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    return false;
  }
}

function acquireUpdateLock(): void {
  fs.writeFileSync(path.join(projectRoot, UPDATE_LOCK), JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }));
}

function releaseUpdateLock(): void {
  try { fs.unlinkSync(path.join(projectRoot, UPDATE_LOCK)); } catch { /* ignore */ }
}

function backupDist(): boolean {
  const distPath = path.join(projectRoot, 'dist');
  const backupPath = path.join(projectRoot, UPDATE_BACKUP);
  if (!fs.existsSync(distPath)) return false;
  try {
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true });
    fs.cpSync(distPath, backupPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function restoreDist(): void {
  const distPath = path.join(projectRoot, 'dist');
  const backupPath = path.join(projectRoot, UPDATE_BACKUP);
  if (!fs.existsSync(backupPath)) return;
  try {
    if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });
    fs.renameSync(backupPath, distPath);
  } catch { /* ignore */ }
}

function cleanupBackup(): void {
  const backupPath = path.join(projectRoot, UPDATE_BACKUP);
  try { if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function cmdUpdate(_args: string[]) {
  console.log(`\n  ${W}🔄 BollaClaw Updater v2${NC}\n`);

  // ── Pre-checks ───────────────────────────────────────────
  // Check git repo
  try {
    cliGit('rev-parse --is-inside-work-tree');
  } catch {
    console.log(`  ${R}✘ Não é um repositório git.${NC}\n`);
    process.exit(1);
  }

  // Check lock
  if (isUpdateLocked()) {
    console.log(`  ${R}✘ Outra atualização em andamento. Tente novamente em alguns minutos.${NC}\n`);
    process.exit(1);
  }

  // Check disk space (need at least 200MB free)
  try {
    const dfOut = cliExec('df -BM --output=avail . | tail -1', 5000).trim();
    const freeMB = parseInt(dfOut.replace('M', ''), 10);
    if (freeMB < 200) {
      console.log(`  ${R}✘ Espaço em disco insuficiente (${freeMB}MB). Necessário: 200MB.${NC}\n`);
      process.exit(1);
    }
  } catch { /* non-fatal, continue */ }

  let previousCommit = '';
  let hasBackup = false;

  try {
    previousCommit = cliGit('rev-parse HEAD').trim();
    const branch = cliGit('branch --show-current').trim() || 'main';

    console.log(`  ${DIM}├─${NC} Commit atual:  ${C}${previousCommit.substring(0, 8)}${NC}`);
    console.log(`  ${DIM}├─${NC} Branch:        ${C}${branch}${NC}`);

    // ── Step 1: Fetch ──────────────────────────────────────
    console.log(`  ${DIM}├─${NC} Verificando atualizações...`);
    cliGit('fetch origin --quiet');

    const remoteCommit = cliGit(`rev-parse origin/${branch}`).trim();

    if (previousCommit === remoteCommit) {
      console.log(`  ${DIM}└─${NC} ${G}✔ Já está atualizado!${NC}\n`);
      return;
    }

    const behind = parseInt(cliGit(`rev-list ${previousCommit}..${remoteCommit} --count`).trim(), 10) || 0;
    if (behind === 0) {
      console.log(`  ${DIM}└─${NC} ${G}✔ Já está atualizado!${NC}\n`);
      return;
    }

    // Show changelog preview
    console.log(`  ${DIM}├─${NC} ${Y}${behind} commit(s) disponíveis${NC}`);
    try {
      const log = cliGit(`log --oneline ${previousCommit}..${remoteCommit} -5`).trim();
      for (const line of log.split('\n')) {
        console.log(`  ${DIM}│  ${NC}  ${DIM}${line}${NC}`);
      }
      if (behind > 5) {
        console.log(`  ${DIM}│  ${NC}  ${DIM}... e mais ${behind - 5}${NC}`);
      }
    } catch { /* non-fatal */ }

    // ── Acquire lock ───────────────────────────────────────
    acquireUpdateLock();

    // ── Step 2: Backup dist/ ───────────────────────────────
    console.log(`  ${DIM}├─${NC} [1/6] Fazendo backup do dist/...`);
    hasBackup = backupDist();
    if (hasBackup) {
      console.log(`  ${DIM}│  ${NC}  ${G}✔ Backup criado${NC}`);
    } else {
      console.log(`  ${DIM}│  ${NC}  ${Y}⚠ Sem dist/ para backup (primeiro build?)${NC}`);
    }

    // ── Step 3: Pull ───────────────────────────────────────
    console.log(`  ${DIM}├─${NC} [2/6] Baixando atualizações...`);
    try { cliGit('reset --hard HEAD'); } catch { /* ignore */ }
    cliGit(`pull origin ${branch} --quiet`);
    console.log(`  ${DIM}│  ${NC}  ${G}✔ Pull OK${NC}`);

    // ── Step 4: Install deps ───────────────────────────────
    console.log(`  ${DIM}├─${NC} [3/6] Instalando dependências...`);
    cliExec('npm install --production=false --quiet 2>&1', 180_000);
    console.log(`  ${DIM}│  ${NC}  ${G}✔ npm install OK${NC}`);

    // ── Step 5: Build ──────────────────────────────────────
    console.log(`  ${DIM}├─${NC} [4/6] Compilando TypeScript...`);
    cliExec('npm run build 2>&1', 180_000);
    console.log(`  ${DIM}│  ${NC}  ${G}✔ Build OK${NC}`);

    // ── Step 6: Verify build ───────────────────────────────
    console.log(`  ${DIM}├─${NC} [5/6] Verificando build...`);
    const mainJs = path.join(projectRoot, 'dist', 'main.js');
    if (!fs.existsSync(mainJs)) {
      throw new Error('Verificação falhou: dist/main.js não encontrado após build');
    }
    // Check file isn't empty
    const stat = fs.statSync(mainJs);
    if (stat.size < 100) {
      throw new Error(`Verificação falhou: dist/main.js muito pequeno (${stat.size} bytes)`);
    }
    console.log(`  ${DIM}│  ${NC}  ${G}✔ dist/main.js verificado (${Math.round(stat.size / 1024)}KB)${NC}`);

    // ── Step 7: PM2 restart ────────────────────────────────
    const newCommit = cliGit('rev-parse HEAD').trim();
    console.log(`  ${DIM}├─${NC} [6/6] Reiniciando via PM2...`);
    console.log(`  ${DIM}│  ${NC}  ${DIM}${previousCommit.substring(0, 8)} → ${newCommit.substring(0, 8)}${NC}`);

    try {
      execSync('pm2 restart bollaclaw --update-env', { cwd: projectRoot, timeout: 30_000 });

      // Wait and check PM2 status
      await new Promise(res => setTimeout(res, 3000));
      try {
        const pm2Status = cliExec('pm2 jlist', 10_000);
        const processes = JSON.parse(pm2Status);
        const bcProcess = processes.find((p: any) => p.name === 'bollaclaw');
        if (bcProcess && bcProcess.pm2_env?.status === 'online') {
          console.log(`  ${DIM}│  ${NC}  ${G}✔ PM2 rodando (status: online)${NC}`);
        } else if (bcProcess) {
          console.log(`  ${DIM}│  ${NC}  ${Y}⚠ PM2 status: ${bcProcess.pm2_env?.status || 'unknown'}${NC}`);
        }
      } catch { /* non-fatal */ }

      // Cleanup backup on success
      cleanupBackup();
      releaseUpdateLock();

      console.log(`  ${DIM}└─${NC} ${G}✔ Atualização concluída com sucesso!${NC}`);
      console.log(`\n  ${DIM}Commit: ${newCommit.substring(0, 8)} | Logs: bollaclaw logs${NC}\n`);

    } catch {
      console.log(`  ${DIM}│  ${NC}  ${Y}⚠ PM2 restart falhou. Execute manualmente: pm2 restart bollaclaw${NC}`);
      // Build succeeded, just PM2 failed — don't rollback, just warn
      cleanupBackup();
      releaseUpdateLock();
      console.log(`  ${DIM}└─${NC} ${Y}⚠ Build OK mas restart falhou. Execute: bollaclaw restart${NC}\n`);
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${DIM}│${NC}`);
    console.log(`  ${R}✘ ERRO: ${msg}${NC}`);
    console.log(`  ${DIM}│${NC}`);

    // ── ROLLBACK ───────────────────────────────────────────
    if (previousCommit && previousCommit !== 'unknown') {
      console.log(`  ${Y}↩ Executando rollback...${NC}`);

      // Rollback git
      try {
        cliGit(`reset --hard ${previousCommit}`);
        console.log(`  ${DIM}├─${NC} Git restaurado para ${C}${previousCommit.substring(0, 8)}${NC}`);
      } catch (gitErr) {
        console.log(`  ${DIM}├─${NC} ${R}Rollback git falhou: ${gitErr}${NC}`);
      }

      // Restore dist/
      if (hasBackup) {
        restoreDist();
        console.log(`  ${DIM}├─${NC} dist/ restaurado do backup`);
      }

      console.log(`  ${DIM}└─${NC} ${G}Rollback concluído. Bot continua funcionando normalmente.${NC}\n`);
    } else {
      console.log(`  ${DIM}└─${NC} ${R}Não foi possível fazer rollback.${NC}\n`);
    }

    releaseUpdateLock();
    process.exit(1);
  }
}

// ── Soul ────────────────────────────────────────────────────

function cmdSoul(args: string[]) {
  const sub = args[0]?.toLowerCase();
  const fs = require('fs');
  const soulPath = path.join(projectRoot, 'data', 'soul.json');

  if (sub === 'reset') {
    if (fs.existsSync(soulPath)) {
      fs.unlinkSync(soulPath);
      console.log(`\n  ${G}✔${NC} Soul resetada. O bootstrap será executado na próxima mensagem.\n`);
    } else {
      console.log(`\n  ${Y}⚠${NC}  Nenhuma soul configurada.\n`);
    }
    return;
  }

  if (sub === 'export') {
    const mdPath = path.join(projectRoot, '.agents', 'SOUL.md');
    if (fs.existsSync(mdPath)) {
      console.log(fs.readFileSync(mdPath, 'utf-8'));
    } else {
      console.log(`\n  ${Y}⚠${NC}  SOUL.md não encontrado. Configure a soul primeiro.\n`);
    }
    return;
  }

  // Default: show current soul
  if (!fs.existsSync(soulPath)) {
    console.log(`\n  ${Y}⚠${NC}  Soul não configurada.`);
    console.log(`  ${DIM}A configuração será feita na primeira mensagem do Telegram.${NC}\n`);
    return;
  }

  try {
    const soul = JSON.parse(fs.readFileSync(soulPath, 'utf-8'));
    console.log(`\n  ${W}🧠 Soul — ${soul.name || 'BollaClaw'}${NC}\n`);
    console.log(`  ${DIM}├─${NC} Dono: ${C}${soul.owner?.name || '(não configurado)'}${NC}`);
    console.log(`  ${DIM}├─${NC} Sobre: ${soul.owner?.description || '—'}`);
    console.log(`  ${DIM}├─${NC} Idioma: ${soul.owner?.language || 'pt-BR'}`);
    console.log(`  ${DIM}├─${NC} Tom: ${soul.style?.tone || '—'}`);

    if (soul.traits) {
      console.log(`  ${DIM}├─${NC} ${W}Traços:${NC}`);
      for (const [key, val] of Object.entries(soul.traits)) {
        const bar = '█'.repeat(Math.round((val as number) / 5)) + '░'.repeat(20 - Math.round((val as number) / 5));
        console.log(`  ${DIM}│  ├─${NC} ${key.padEnd(15)} ${bar} ${val}/100`);
      }
    }

    console.log(`  ${DIM}├─${NC} Conversas: ${G}${soul.adaptiveData?.conversationCount || 0}${NC}`);
    console.log(`  ${DIM}├─${NC} Versão: ${soul.version || '1.0.0'}`);
    console.log(`  ${DIM}└─${NC} Atualizado: ${soul.updatedAt || '—'}\n`);

  } catch (err) {
    console.log(`\n  ${R}✘${NC} Erro ao ler soul.json\n`);
  }
}

// ── Web Panel ───────────────────────────────────────────────

function cmdWeb() {
  const envPath = path.join(projectRoot, '.env');
  let port = '21086';

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/ADMIN_PORT=(\d+)/);
    if (match) port = match[1];
  }

  const hostname = (() => {
    try { return execSync('hostname -I', { encoding: 'utf-8' }).trim().split(' ')[0]; }
    catch { return 'localhost'; }
  })();

  const serverHostname = (() => {
    try { return execSync('hostname', { encoding: 'utf-8' }).trim(); }
    catch { return 'servidor'; }
  })();

  console.log(`
  ${W}🌐 BollaClaw Web Panel${NC}

  ${BOLD}Acesso local:${NC}
    ${C}http://localhost:${port}${NC}
    ${C}http://${hostname}:${port}${NC}

  ${BOLD}Acesso remoto (SSH tunnel):${NC}
    ${DIM}No seu computador, execute:${NC}

    ${G}ssh -L ${port}:localhost:${port} ubuntu@${hostname}${NC}

    ${DIM}Depois abra no navegador:${NC}
    ${C}http://localhost:${port}${NC}

  ${BOLD}Senha:${NC}
    ${DIM}Definida na instalação (ADMIN_PASSWORD no .env)${NC}
    ${DIM}Recomendado trocar no primeiro acesso.${NC}
`);

  // Try to check if panel is running
  try {
    execSync(`curl -s --connect-timeout 2 http://localhost:${port}/api/health`, { encoding: 'utf-8' });
    console.log(`  ${G}●${NC} Painel ${G}online${NC} e funcionando\n`);
  } catch {
    console.log(`  ${Y}●${NC} Painel ${Y}não detectado${NC} — verifique se o bot está rodando\n`);
    console.log(`  ${DIM}Inicie com: ${C}bollaclaw start${NC}\n`);
  }
}

// ── Change Password ──────────────────────────────────────────

function cmdChangePassword(args: string[]) {
  if (args[0]?.toLowerCase() !== 'password') {
    console.log(`\n  ${R}✘${NC} Uso: ${C}bollaclaw change password${NC}`);
    console.log(`  ${DIM}Altera a senha do painel web.${NC}\n`);
    process.exit(1);
  }

  const credPath = path.join(projectRoot, 'data', 'web-credentials.json');
  if (!fs.existsSync(credPath)) {
    console.log(`\n  ${R}✘${NC} Credenciais não encontradas. O painel já foi iniciado ao menos uma vez?\n`);
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string, hidden = false): Promise<string> =>
    new Promise(resolve => {
      if (hidden) {
        process.stdout.write(q);
        let input = '';
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf-8');
        const handler = (ch: string) => {
          if (ch === '\r' || ch === '\n') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', handler);
            process.stdout.write('\n');
            resolve(input);
          } else if (ch === '\u0003') {
            process.exit();
          } else if (ch === '\u007f') {
            if (input.length > 0) input = input.slice(0, -1);
          } else {
            input += ch;
          }
        };
        stdin.on('data', handler);
      } else {
        rl.question(q, answer => resolve(answer));
      }
    });

  (async () => {
    try {
      console.log(`\n  ${W}Alterar senha do painel web${NC}\n`);

      const current = await ask(`  Senha atual: `, true);
      const hashCurrent = crypto.pbkdf2Sync(current, creds.salt, 100000, 64, 'sha512').toString('hex');
      if (!crypto.timingSafeEqual(Buffer.from(hashCurrent, 'hex'), Buffer.from(creds.hash, 'hex'))) {
        console.log(`\n  ${R}✘${NC} Senha atual incorreta.\n`);
        rl.close();
        process.exit(1);
      }

      const newPwd = await ask(`  Nova senha (mín. 8 caracteres): `, true);
      if (newPwd.length < 8) {
        console.log(`\n  ${R}✘${NC} A nova senha deve ter pelo menos 8 caracteres.\n`);
        rl.close();
        process.exit(1);
      }

      const newSalt = crypto.randomBytes(32).toString('hex');
      const newHash = crypto.pbkdf2Sync(newPwd, newSalt, 100000, 64, 'sha512').toString('hex');

      const history: string[] = creds.passwordHistory || [];
      if (history.some((h: string) => {
        try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(crypto.pbkdf2Sync(newPwd, creds.salt, 100000, 64, 'sha512').toString('hex'), 'hex')); }
        catch { return false; }
      })) {
        console.log(`\n  ${R}✘${NC} Não é possível reutilizar uma senha recente.\n`);
        rl.close();
        process.exit(1);
      }

      creds.passwordHistory = [creds.hash, ...history].slice(0, 3);
      creds.hash = newHash;
      creds.salt = newSalt;
      creds.mustChangePassword = false;
      fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });

      console.log(`\n  ${G}✔${NC} Senha alterada com sucesso!\n`);
      console.log(`  ${DIM}Todas as sessões ativas foram invalidadas.${NC}\n`);
      console.log(`  ${DIM}Reinicie o bot para aplicar: ${C}bollaclaw restart${NC}\n`);
    } finally {
      rl.close();
    }
  })();
}

// ── Help ─────────────────────────────────────────────────────

function showHelp() {
  console.log(`
  ${C}    ____        ____       ${M}________               ${NC}
  ${C}   / __ )____  / / /___ _ ${M}/ ____/ /___ __      __${NC}
  ${C}  / __  / __ \\/ / / __ \`/${M}/ /   / / __ \`/ | /| / /${NC}
  ${C} / /_/ / /_/ / / / /_/ /${M}/ /___/ / /_/ /| |/ |/ / ${NC}
  ${C}/_____/\\____/_/_/\\__,_/${M} \\____/_/\\__,_/ |__/|__/  ${NC}

  ${W}CLI v0.1${NC} ${DIM}— Gerenciamento do seu bot de IA${NC}

  ${W}USUÁRIOS${NC}
  ${DIM}├─${NC} ${C}bollaclaw add <CODE>${NC}      Aprovar usuário pelo código
  ${DIM}├─${NC} ${C}bollaclaw users${NC}           Listar usuários aprovados
  ${DIM}├─${NC} ${C}bollaclaw pending${NC}         Solicitações pendentes
  ${DIM}├─${NC} ${C}bollaclaw remove <ID>${NC}     Remover usuário
  ${DIM}└─${NC} ${C}bollaclaw admin <ID>${NC}      Promover a admin

  ${W}MODELOS DE IA${NC}
  ${DIM}├─${NC} ${C}bollaclaw models${NC}          Ver modelos disponíveis
  ${DIM}├─${NC} ${C}bollaclaw models set <ID>${NC} Trocar modelo ativo
  ${DIM}└─${NC} ${C}bollaclaw models fetch${NC}    Baixar catálogo OpenRouter

  ${W}SOUL & IDENTIDADE${NC}
  ${DIM}├─${NC} ${C}bollaclaw soul${NC}             Ver config atual da soul
  ${DIM}├─${NC} ${C}bollaclaw soul reset${NC}       Resetar soul (refaz bootstrap)
  ${DIM}└─${NC} ${C}bollaclaw soul export${NC}      Exportar SOUL.md

  ${W}SERVIÇO${NC}
  ${DIM}├─${NC} ${C}bollaclaw status${NC}          Status detalhado
  ${DIM}├─${NC} ${C}bollaclaw restart${NC}         Reiniciar bot
  ${DIM}├─${NC} ${C}bollaclaw start${NC}           Iniciar bot
  ${DIM}├─${NC} ${C}bollaclaw stop${NC}            Parar bot
  ${DIM}├─${NC} ${C}bollaclaw logs${NC}            Ver logs (últimas 50 linhas)
  ${DIM}├─${NC} ${C}bollaclaw update${NC}          Checar e aplicar atualização
  ${DIM}├─${NC} ${C}bollaclaw web${NC}             Painel web (admin dashboard)
  ${DIM}└─${NC} ${C}bollaclaw change password${NC} Altera a senha do painel web

  ${W}EXEMPLOS${NC}
  ${DIM}$${NC} bollaclaw add A3X9K2                ${DIM}# Aprovar novo usuário${NC}
  ${DIM}$${NC} bollaclaw models                    ${DIM}# Ver modelos${NC}
  ${DIM}$${NC} bollaclaw models set gpt-4o          ${DIM}# Trocar para GPT-4o${NC}
  ${DIM}$${NC} bollaclaw soul                       ${DIM}# Ver personalidade${NC}
  ${DIM}$${NC} bollaclaw update                     ${DIM}# Atualizar do GitHub${NC}
  ${DIM}$${NC} bollaclaw web                        ${DIM}# Abrir painel admin${NC}
`);
}

// ── Helpers ──────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Handle async commands
const args = process.argv.slice(2);
const cmd = args[0]?.toLowerCase();
if (cmd === 'models' || cmd === 'update') {
  const fn = cmd === 'models' ? cmdModels(args.slice(1)) : cmdUpdate(args.slice(1));
  fn.catch((err: Error) => {
    console.error(`\n  ${R}✘${NC} Erro: ${err.message}\n`);
    process.exit(1);
  });
} else {
  main();
}
