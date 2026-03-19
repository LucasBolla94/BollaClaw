#!/usr/bin/env node
/**
 * BollaClaw Onboard CLI
 * Run: npx ts-node src/onboard/cli.ts
 * Or after build: node dist/onboard/cli.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { OnboardManager } from './OnboardManager';

const ENV_FILE = path.resolve(process.cwd(), '.env');

function ask(rl: readline.Interface, question: string, defaultVal = ''): Promise<string> {
  const suffix = defaultVal ? ` \x1b[90m[${defaultVal}]\x1b[0m` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askRequired(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    const doAsk = () => {
      rl.question(`  ${question}: `, (answer) => {
        const val = answer.trim();
        if (!val) {
          console.log('  \x1b[31m⚠ Este campo é obrigatório.\x1b[0m');
          doAsk();
        } else {
          resolve(val);
        }
      });
    };
    doAsk();
  });
}

async function setupEnv(rl: readline.Interface): Promise<void> {
  if (fs.existsSync(ENV_FILE)) {
    console.log('');
    console.log('  ⚠️  Arquivo .env já existe.');
    const overwrite = await ask(rl, 'Deseja reconfigurar? (s/n)', 'n');
    if (overwrite.toLowerCase() !== 's') return;
  }

  // ─── TELEGRAM ───────────────────────────────────────
  console.log('');
  console.log('  \x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║  📱 Configuração do Telegram         ║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  Crie um bot no Telegram via @BotFather');
  console.log('  e copie o token aqui.');
  console.log('');

  const botToken = await askRequired(rl, 'Telegram Bot Token');

  console.log('');
  console.log('  Para descobrir seu User ID, envie /start para @userinfobot');
  console.log('  Separe múltiplos IDs por vírgula.');
  console.log('');

  const allowedIds = await askRequired(rl, 'Telegram User ID(s) permitidos');

  // ─── LLM PROVIDER ──────────────────────────────────
  console.log('');
  console.log('  \x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║  🧠 Provedor de IA (LLM)             ║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  Escolha o provedor principal de IA:');
  console.log('');
  console.log('  1. \x1b[1mClaude (Anthropic)\x1b[0m — recomendado');
  console.log('  2. Gemini (Google)');
  console.log('  3. DeepSeek');
  console.log('  4. Groq');
  console.log('  5. OpenRouter (multi-modelo)');
  console.log('  6. xAI (Grok)');
  console.log('  7. OpenAI (GPT)');
  console.log('');

  const providerChoice = await ask(rl, 'Escolha (1-7)', '1');
  const providerMap: Record<string, { name: string; envKey: string; defaultModel: string }> = {
    '1': { name: 'claude', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-20250514' },
    '2': { name: 'gemini', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.0-flash' },
    '3': { name: 'deepseek', envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
    '4': { name: 'groq', envKey: 'GROQ_API_KEY', defaultModel: 'llama-3.3-70b-versatile' },
    '5': { name: 'openrouter', envKey: 'OPENROUTER_API_KEY', defaultModel: 'anthropic/claude-3.5-sonnet' },
    '6': { name: 'xai', envKey: 'XAI_API_KEY', defaultModel: 'grok-2-latest' },
    '7': { name: 'openai', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
  };

  const selected = providerMap[providerChoice] ?? providerMap['1'];

  console.log('');
  console.log(`  Provedor selecionado: \x1b[32m${selected.name}\x1b[0m`);
  console.log('');

  const mainApiKey = await askRequired(rl, `API Key do ${selected.name}`);

  console.log('');
  console.log(`  Modelo padrão: \x1b[33m${selected.defaultModel}\x1b[0m`);
  const mainModel = await ask(rl, 'Modelo (ENTER para usar o padrão)', selected.defaultModel);

  // ─── ADDITIONAL API KEYS ───────────────────────────
  console.log('');
  console.log('  \x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║  🔑 API Keys adicionais (opcional)   ║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  Groq é recomendado para transcrição de áudio (Whisper).');
  console.log('  Pressione ENTER para pular as que não usar.');
  console.log('');

  // Collect all API keys — pre-fill the selected one
  const apiKeys: Record<string, string> = {
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    GROQ_API_KEY: '',
    OPENAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    XAI_API_KEY: '',
  };

  // Set the main provider key
  apiKeys[selected.envKey] = mainApiKey;

  // Ask for other keys
  const keyLabels: Record<string, string> = {
    ANTHROPIC_API_KEY: 'Anthropic (Claude)',
    GEMINI_API_KEY: 'Gemini (Google)',
    DEEPSEEK_API_KEY: 'DeepSeek',
    GROQ_API_KEY: 'Groq (Whisper STT + LLM)',
    OPENAI_API_KEY: 'OpenAI (GPT)',
    OPENROUTER_API_KEY: 'OpenRouter',
    XAI_API_KEY: 'xAI (Grok)',
  };

  for (const [key, label] of Object.entries(keyLabels)) {
    if (key === selected.envKey) continue; // Already have this one
    apiKeys[key] = await ask(rl, `${label} API Key`, '');
  }

  // ─── GROQ STT ──────────────────────────────────────
  const groqKey = apiKeys.GROQ_API_KEY;
  const sttProvider = groqKey ? 'groq_whisper' : 'none';

  // ─── ADMIN PANEL ───────────────────────────────────
  console.log('');
  console.log('  \x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║  🖥️  Painel Admin                     ║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════╝\x1b[0m');
  console.log('');

  const adminPass = await ask(rl, 'Senha do painel Admin', 'bollaclaw');
  const adminPort = await ask(rl, 'Porta do painel Admin', '3000');

  // ─── BUILD .env ────────────────────────────────────
  const envContent = `# =============================================
# BollaClaw V0.1 - Environment Configuration
# Generated by onboard on ${new Date().toISOString()}
# =============================================

# --- Telegram ---
TELEGRAM_BOT_TOKEN=${botToken}
TELEGRAM_ALLOWED_USER_IDS=${allowedIds}

# --- LLM Provider ---
LLM_PROVIDER=${selected.name}
LLM_MODEL=${mainModel}

# API Keys
ANTHROPIC_API_KEY=${apiKeys.ANTHROPIC_API_KEY}
GEMINI_API_KEY=${apiKeys.GEMINI_API_KEY}
DEEPSEEK_API_KEY=${apiKeys.DEEPSEEK_API_KEY}
GROQ_API_KEY=${apiKeys.GROQ_API_KEY}
OPENAI_API_KEY=${apiKeys.OPENAI_API_KEY}
OPENROUTER_API_KEY=${apiKeys.OPENROUTER_API_KEY}
XAI_API_KEY=${apiKeys.XAI_API_KEY}

# --- Agent Config ---
MAX_ITERATIONS=5
MEMORY_WINDOW_SIZE=20
SKILLS_DIR=.agents/skills

# --- Audio (STT/TTS) ---
STT_PROVIDER=${sttProvider}
TTS_VOICE=pt-BR-ThalitaMultilingualNeural
AUTO_AUDIO_REPLY=true

# --- Admin Panel ---
ADMIN_ENABLED=true
ADMIN_PORT=${adminPort}
ADMIN_PASSWORD=${adminPass}
ADMIN_HOST=0.0.0.0

# --- Paths ---
DATA_DIR=./data
TMP_DIR=./tmp
LOGS_DIR=./logs

# --- Logging ---
LOG_LEVEL=info
`;

  fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
  console.log('');
  console.log('  \x1b[32m✅ Arquivo .env criado com sucesso!\x1b[0m');
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log('\x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║    🤖 BollaClaw V0.1 - Setup Wizard     ║\x1b[0m');
  console.log('\x1b[36m╠══════════════════════════════════════════╣\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  Este wizard vai configurar:             \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  1. Token do Telegram Bot                \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  2. Provedor de IA + API Key + Modelo    \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  3. Identidade e comportamento do agente \x1b[36m║\x1b[0m');
  console.log('\x1b[36m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');

  // Step 1: Setup .env (Telegram + LLM + API keys)
  await setupEnv(rl);

  // Step 2: Onboard identity
  rl.close();
  const onboard = new OnboardManager();
  await onboard.runInteractiveOnboard();

  console.log('');
  console.log('\x1b[32m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[32m║  🚀 Setup completo!                     ║\x1b[0m');
  console.log('\x1b[32m║                                         ║\x1b[0m');
  console.log('\x1b[32m║\x1b[0m  O BollaClaw será iniciado pelo PM2.     \x1b[32m║\x1b[0m');
  console.log('\x1b[32m║\x1b[0m  Use: pm2 logs bollaclaw                 \x1b[32m║\x1b[0m');
  console.log('\x1b[32m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
}

main().catch((err) => {
  console.error(`❌ Erro no onboard: ${err.message}`);
  process.exit(1);
});
