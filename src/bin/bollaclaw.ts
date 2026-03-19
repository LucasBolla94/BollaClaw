#!/usr/bin/env node
// ============================================================
// BollaClaw CLI — Server-side command interface
// ============================================================
// Usage:
//   bollaclaw add <CODE>      — Approve a pending user by code
//   bollaclaw users           — List approved users
//   bollaclaw pending         — List pending approval requests
//   bollaclaw remove <ID>     — Remove a user by Telegram ID
//   bollaclaw admin <ID>      — Promote a user to admin
//   bollaclaw status          — Show bot status
//   bollaclaw restart         — Restart BollaClaw via PM2
//   bollaclaw logs            — Show PM2 logs
//   bollaclaw help            — Show this help
// ============================================================

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the bollaclaw directory
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import { UserManager } from '../auth/UserManager';
import { execSync } from 'child_process';

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const CYAN = '\x1b[0;36m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  const userManager = new UserManager(path.join(projectRoot, 'data'));

  switch (command) {
    case 'add':
      return cmdAdd(userManager, args.slice(1));
    case 'users':
    case 'list':
      return cmdListUsers(userManager);
    case 'pending':
      return cmdListPending(userManager);
    case 'remove':
    case 'rm':
      return cmdRemove(userManager, args.slice(1));
    case 'admin':
      return cmdPromoteAdmin(userManager, args.slice(1));
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
    default:
      console.log(`${RED}Comando desconhecido: ${command}${NC}`);
      console.log(`Use ${CYAN}bollaclaw help${NC} para ver os comandos disponíveis.`);
      process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────────

function cmdAdd(um: UserManager, args: string[]) {
  const code = args[0];
  if (!code) {
    console.log(`${RED}Uso: bollaclaw add <CÓDIGO>${NC}`);
    console.log(`O código é exibido quando um novo usuário envia mensagem ao bot.`);
    process.exit(1);
  }

  const result = um.approveByCode(code);
  if (result.success && result.user) {
    console.log(`${GREEN}✅ Usuário aprovado!${NC}`);
    console.log(`  Telegram ID: ${CYAN}${result.user.telegramId}${NC}`);
    if (result.user.name) {
      console.log(`  Nome: ${result.user.name}`);
    }
    console.log(`\nO usuário já pode interagir com o bot.`);
  } else {
    console.log(`${RED}❌ ${result.error}${NC}`);
    const pending = um.listPending();
    if (pending.length > 0) {
      console.log(`\n${YELLOW}Códigos pendentes:${NC}`);
      for (const p of pending) {
        console.log(`  ${BOLD}${p.code}${NC} — ${p.telegramName} (ID: ${p.telegramId})`);
      }
    } else {
      console.log(`Nenhum código pendente no momento.`);
    }
    process.exit(1);
  }
}

function cmdListUsers(um: UserManager) {
  const users = um.listApproved();
  const admins = um.listAdmins();

  if (users.length === 0) {
    console.log(`${YELLOW}Nenhum usuário aprovado.${NC}`);
    return;
  }

  console.log(`${BOLD}Usuários aprovados (${users.length}):${NC}\n`);
  for (const u of users) {
    const isAdmin = admins.includes(u.telegramId);
    const badge = isAdmin ? ` ${YELLOW}[ADMIN]${NC}` : '';
    const name = u.name ? ` (${u.name})` : '';
    console.log(`  ${CYAN}${u.telegramId}${NC}${name}${badge} — aprovado em ${u.approvedAt.split('T')[0]}`);
  }
}

function cmdListPending(um: UserManager) {
  const pending = um.listPending();

  if (pending.length === 0) {
    console.log(`${GREEN}Nenhuma solicitação pendente.${NC}`);
    return;
  }

  console.log(`${BOLD}Solicitações pendentes (${pending.length}):${NC}\n`);
  for (const p of pending) {
    const expires = new Date(p.expiresAt).toLocaleString('pt-BR');
    console.log(`  ${BOLD}${p.code}${NC} — ${p.telegramName} (ID: ${p.telegramId})`);
    console.log(`    Expira em: ${expires}`);
    console.log(`    ${CYAN}bollaclaw add ${p.code}${NC}\n`);
  }
}

function cmdRemove(um: UserManager, args: string[]) {
  const telegramId = args[0];
  if (!telegramId) {
    console.log(`${RED}Uso: bollaclaw remove <TELEGRAM_ID>${NC}`);
    process.exit(1);
  }

  if (um.removeUser(telegramId)) {
    console.log(`${GREEN}✅ Usuário ${telegramId} removido.${NC}`);
  } else {
    console.log(`${RED}Usuário ${telegramId} não encontrado.${NC}`);
    process.exit(1);
  }
}

function cmdPromoteAdmin(um: UserManager, args: string[]) {
  const telegramId = args[0];
  if (!telegramId) {
    console.log(`${RED}Uso: bollaclaw admin <TELEGRAM_ID>${NC}`);
    process.exit(1);
  }

  if (um.promoteAdmin(telegramId)) {
    console.log(`${GREEN}✅ Usuário ${telegramId} promovido a admin.${NC}`);
  } else {
    console.log(`${RED}Usuário não encontrado ou já é admin.${NC}`);
    process.exit(1);
  }
}

function cmdStatus() {
  try {
    const output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf-8' });
    const processes = JSON.parse(output);
    const bc = processes.find((p: any) => p.name === 'bollaclaw');

    if (bc) {
      const status = bc.pm2_env?.status ?? 'unknown';
      const statusColor = status === 'online' ? GREEN : RED;
      const uptime = bc.pm2_env?.pm_uptime
        ? formatUptime(Date.now() - bc.pm2_env.pm_uptime)
        : 'N/A';
      const memory = bc.monit?.memory
        ? `${Math.round(bc.monit.memory / 1024 / 1024)}MB`
        : 'N/A';
      const cpu = bc.monit?.cpu ?? 'N/A';
      const restarts = bc.pm2_env?.restart_time ?? 0;

      console.log(`${BOLD}🤖 BollaClaw Status${NC}\n`);
      console.log(`  Status:    ${statusColor}${status}${NC}`);
      console.log(`  Uptime:    ${uptime}`);
      console.log(`  Memória:   ${memory}`);
      console.log(`  CPU:       ${cpu}%`);
      console.log(`  Restarts:  ${restarts}`);
      console.log(`  PID:       ${bc.pid}`);
    } else {
      console.log(`${YELLOW}BollaClaw não está rodando via PM2.${NC}`);
      console.log(`Use ${CYAN}bollaclaw start${NC} para iniciar.`);
    }
  } catch {
    console.log(`${RED}PM2 não encontrado ou não acessível.${NC}`);
  }
}

function cmdRestart() {
  console.log(`${CYAN}Reiniciando BollaClaw...${NC}`);
  try {
    execSync('pm2 restart bollaclaw', { stdio: 'inherit' });
    console.log(`${GREEN}✅ Reiniciado!${NC}`);
  } catch {
    console.log(`${RED}Falha ao reiniciar. BollaClaw pode não estar rodando.${NC}`);
    console.log(`Use ${CYAN}bollaclaw start${NC} para iniciar.`);
  }
}

function cmdStop() {
  console.log(`${CYAN}Parando BollaClaw...${NC}`);
  try {
    execSync('pm2 stop bollaclaw', { stdio: 'inherit' });
    console.log(`${GREEN}✅ Parado.${NC}`);
  } catch {
    console.log(`${RED}Falha ao parar.${NC}`);
  }
}

function cmdStart() {
  console.log(`${CYAN}Iniciando BollaClaw...${NC}`);
  try {
    execSync(`pm2 start ${path.join(projectRoot, 'ecosystem.config.js')}`, { stdio: 'inherit' });
    console.log(`${GREEN}✅ Iniciado!${NC}`);
  } catch {
    console.log(`${RED}Falha ao iniciar.${NC}`);
  }
}

function cmdLogs() {
  try {
    execSync('pm2 logs bollaclaw --lines 50', { stdio: 'inherit' });
  } catch {
    console.log(`${RED}Falha ao exibir logs.${NC}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function showHelp() {
  console.log(`
${BOLD}🤖 BollaClaw CLI${NC}

${BOLD}Gerenciamento de usuários:${NC}
  ${CYAN}bollaclaw add <CODE>${NC}      Aprovar usuário pelo código
  ${CYAN}bollaclaw users${NC}           Listar usuários aprovados
  ${CYAN}bollaclaw pending${NC}         Listar solicitações pendentes
  ${CYAN}bollaclaw remove <ID>${NC}     Remover usuário por Telegram ID
  ${CYAN}bollaclaw admin <ID>${NC}      Promover usuário a admin

${BOLD}Gerenciamento do serviço:${NC}
  ${CYAN}bollaclaw status${NC}          Status do bot
  ${CYAN}bollaclaw restart${NC}         Reiniciar o bot
  ${CYAN}bollaclaw start${NC}           Iniciar o bot
  ${CYAN}bollaclaw stop${NC}            Parar o bot
  ${CYAN}bollaclaw logs${NC}            Ver logs do bot

${BOLD}Exemplos:${NC}
  bollaclaw add A3X9K2         # Aprovar usuário com código A3X9K2
  bollaclaw users              # Ver quem tem acesso
  bollaclaw restart            # Reiniciar após mudanças
`);
}

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

main();
