#!/usr/bin/env node
// ============================================================
// BollaClaw CLI — Server-side command interface
// ============================================================

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as readline from 'readline';

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

// ── Update ──────────────────────────────────────────────────

async function cmdUpdate(_args: string[]) {
  console.log(`\n  ${W}🔄 Auto-Updater${NC}\n`);

  try {
    const currentCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: projectRoot }).trim();
    console.log(`  ${DIM}├─${NC} Commit atual: ${C}${currentCommit.substring(0, 8)}${NC}`);

    console.log(`  ${DIM}├─${NC} Verificando atualizações...`);
    execSync('git fetch origin --quiet', { cwd: projectRoot, timeout: 15000 });

    const branch = execSync('git branch --show-current', { encoding: 'utf-8', cwd: projectRoot }).trim();
    const remoteCommit = execSync(`git rev-parse origin/${branch}`, { encoding: 'utf-8', cwd: projectRoot }).trim();

    if (currentCommit === remoteCommit) {
      console.log(`  ${DIM}└─${NC} ${G}✔ Já está atualizado!${NC}\n`);
      return;
    }

    const behind = execSync(`git rev-list ${currentCommit}..${remoteCommit} --count`, { encoding: 'utf-8', cwd: projectRoot }).trim();
    console.log(`  ${DIM}├─${NC} ${Y}${behind} commit(s) disponíveis${NC}`);
    console.log(`  ${DIM}├─${NC} Aplicando atualização...`);

    execSync(`git pull origin ${branch} --quiet`, { cwd: projectRoot, timeout: 30000 });
    console.log(`  ${DIM}├─${NC} ${G}✔ Pull OK${NC}`);

    console.log(`  ${DIM}├─${NC} Instalando dependências...`);
    execSync('npm install --production=false --quiet 2>&1', { cwd: projectRoot, timeout: 120000 });

    console.log(`  ${DIM}├─${NC} Compilando...`);
    execSync('npm run build 2>&1', { cwd: projectRoot, timeout: 120000 });

    const newCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: projectRoot }).trim();
    console.log(`  ${DIM}├─${NC} Novo commit: ${G}${newCommit.substring(0, 8)}${NC}`);
    console.log(`  ${DIM}└─${NC} ${G}✔ Atualização concluída!${NC}`);
    console.log(`\n  ${Y}⚠${NC}  Execute ${C}bollaclaw restart${NC} para aplicar.\n`);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${DIM}└─${NC} ${R}✘ Erro: ${msg}${NC}\n`);
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
  ${DIM}└─${NC} ${C}bollaclaw update${NC}          Checar e aplicar atualização

  ${W}EXEMPLOS${NC}
  ${DIM}$${NC} bollaclaw add A3X9K2                ${DIM}# Aprovar novo usuário${NC}
  ${DIM}$${NC} bollaclaw models                    ${DIM}# Ver modelos${NC}
  ${DIM}$${NC} bollaclaw models set gpt-4o          ${DIM}# Trocar para GPT-4o${NC}
  ${DIM}$${NC} bollaclaw soul                       ${DIM}# Ver personalidade${NC}
  ${DIM}$${NC} bollaclaw update                     ${DIM}# Atualizar do GitHub${NC}
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
