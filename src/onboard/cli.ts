#!/usr/bin/env node
/**
 * BollaClaw Onboard CLI — Setup Wizard
 * Inspired by OpenClaw's onboarding flow.
 *
 * Run: node dist/onboard/cli.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { OnboardManager } from './OnboardManager';

const ENV_FILE = path.resolve(process.cwd(), '.env');

// ─── ANSI helpers ────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgCyan: '\x1b[46m',
};

function box(title: string): void {
  const line = '═'.repeat(48);
  console.log(`  ${C.cyan}╔${line}╗${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}${title.padEnd(46)}${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}╚${line}╝${C.reset}`);
}

function sectionHeader(num: number, total: number, title: string): void {
  console.log('');
  console.log(`  ${C.bold}${C.yellow}[${num}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
  console.log(`  ${'─'.repeat(48)}`);
}

// ─── Input helpers ───────────────────────────────────────
function ask(rl: readline.Interface, question: string, defaultVal = ''): Promise<string> {
  const suffix = defaultVal ? ` ${C.dim}[${defaultVal}]${C.reset}` : '';
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
          console.log(`  ${C.red}⚠ Este campo é obrigatório.${C.reset}`);
          doAsk();
        } else {
          resolve(val);
        }
      });
    };
    doAsk();
  });
}

async function askChoice(rl: readline.Interface, options: { label: string; value: string; desc?: string }[], prompt = 'Escolha'): Promise<string> {
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const num = `${C.bold}${C.white}${i + 1}.${C.reset}`;
    const desc = opt.desc ? ` ${C.dim}— ${opt.desc}${C.reset}` : '';
    console.log(`  ${num} ${opt.label}${desc}`);
  }
  console.log('');
  const answer = await ask(rl, `${prompt} (1-${options.length})`, '1');
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < options.length) {
    return options[idx].value;
  }
  return options[0].value;
}

// ═══════════════════════════════════════════════════════════
// Provider + Model definitions
// ═══════════════════════════════════════════════════════════

interface ModelDef {
  id: string;
  name: string;
  desc: string;
}

interface ProviderGroup {
  id: string;
  name: string;
  desc: string;
  envKey: string;
  baseUrl?: string;
  models: ModelDef[];
  allowCustomModel?: boolean;
}

const PROVIDERS: ProviderGroup[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    desc: 'Modelos Claude — excelente em código e raciocínio',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', desc: 'Mais inteligente — $5/$25 por MTok' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Melhor custo-benefício — $3/$15 por MTok' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', desc: 'Mais rápido e barato — $1/$5 por MTok' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', desc: 'Versão anterior — estável' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', desc: 'Versão anterior — premium' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT / Codex)',
    desc: 'Modelos GPT e Codex — uso geral e coding',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', desc: 'Flagship — 1M context, coding + raciocínio' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', desc: 'Rápido e econômico' },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', desc: 'Otimizado para coding agentic' },
      { id: 'gpt-4o', name: 'GPT-4o', desc: 'Multimodal — texto, imagem, áudio' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', desc: 'Rápido e barato' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    desc: 'Modelos Grok — raciocínio avançado, 2M context',
    envKey: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-4', name: 'Grok 4', desc: 'Modelo principal — raciocínio profundo' },
      { id: 'grok-4-fast', name: 'Grok 4 Fast', desc: 'Rápido com raciocínio' },
      { id: 'grok-4-1-fast', name: 'Grok 4.1 Fast', desc: 'Mais novo — agent tools optimized' },
      { id: 'grok-code-fast-1', name: 'Grok Code Fast', desc: 'Otimizado para coding — 256K context' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (Multi-Modelo)',
    desc: 'Acesso a 500+ modelos via uma única API',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    allowCustomModel: true,
    models: [
      // ── Anthropic via OpenRouter ──
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', desc: 'Anthropic — melhor agente' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Anthropic — custo-benefício' },
      { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', desc: 'Anthropic — rápido e barato' },
      // ── OpenAI via OpenRouter ──
      { id: 'openai/gpt-5.4', name: 'GPT-5.4', desc: 'OpenAI — flagship' },
      { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', desc: 'OpenAI — econômico' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', desc: 'OpenAI — multimodal' },
      // ── Google via OpenRouter ──
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Google — forte em raciocínio' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Google — rápido e grátis' },
      // ── xAI via OpenRouter ──
      { id: 'x-ai/grok-4', name: 'Grok 4', desc: 'xAI — raciocínio profundo' },
      { id: 'x-ai/grok-4-1-fast', name: 'Grok 4.1 Fast', desc: 'xAI — rápido' },
      // ── DeepSeek ──
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3', desc: 'Frontier-level, 1/50x custo' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', desc: 'Raciocínio profundo' },
      // ── Meta Llama ──
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', desc: 'Meta — MoE, open-source' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', desc: 'Meta — gratuito' },
      // ── Qwen ──
      { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', desc: 'Alibaba — coding SOTA, gratuito' },
      { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', desc: 'Alibaba — MoE, forte' },
      // ── Mistral ──
      { id: 'mistralai/mistral-large-2', name: 'Mistral Large 2', desc: 'Mistral — europeu, forte' },
      { id: 'mistralai/codestral-latest', name: 'Codestral', desc: 'Mistral — coding' },
      // ── Others ──
      { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Hermes 3 405B', desc: 'NousResearch — open-source' },
      { id: 'openrouter/auto', name: 'Auto (OpenRouter)', desc: 'Melhor modelo automático por prompt' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Wizard steps
// ═══════════════════════════════════════════════════════════

async function stepTelegram(rl: readline.Interface): Promise<{ botToken: string; userIds: string }> {
  sectionHeader(1, 4, '📱 Telegram Bot');

  console.log('');
  console.log(`  Crie um bot no Telegram via ${C.cyan}@BotFather${C.reset}`);
  console.log(`  e cole o token aqui.`);
  console.log('');

  const botToken = await askRequired(rl, `Bot Token ${C.dim}(do @BotFather)${C.reset}`);

  console.log('');
  console.log(`  Para descobrir seu User ID, envie /start para ${C.cyan}@userinfobot${C.reset}`);
  console.log(`  Separe múltiplos IDs por vírgula.`);
  console.log('');

  const userIds = await askRequired(rl, 'Telegram User ID(s) permitidos');

  console.log(`  ${C.green}✓${C.reset} Telegram configurado`);
  return { botToken, userIds };
}

async function stepProvider(rl: readline.Interface): Promise<{
  providerId: string;
  providerName: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}> {
  sectionHeader(2, 4, '🧠 Provedor de IA (LLM)');

  console.log('');
  console.log(`  Escolha o provedor principal para o agente:`);
  console.log('');

  const providerChoice = await askChoice(
    rl,
    PROVIDERS.map((p) => ({ label: p.name, value: p.id, desc: p.desc })),
    'Provedor',
  );

  const provider = PROVIDERS.find((p) => p.id === providerChoice) ?? PROVIDERS[0];

  console.log('');
  console.log(`  ${C.green}►${C.reset} ${C.bold}${provider.name}${C.reset} selecionado`);
  console.log('');

  // API Key
  const apiKey = await askRequired(rl, `API Key do ${provider.name}`);

  // Model selection
  console.log('');
  console.log(`  ${C.bold}Escolha o modelo:${C.reset}`);
  console.log('');

  const modelOptions = provider.models.map((m) => ({
    label: m.name,
    value: m.id,
    desc: m.desc,
  }));

  // Add custom model option for OpenRouter
  if (provider.allowCustomModel) {
    modelOptions.push({
      label: `${C.yellow}Modelo personalizado${C.reset}`,
      value: '__custom__',
      desc: 'Digite o ID do modelo manualmente',
    });
  }

  let model = await askChoice(rl, modelOptions, 'Modelo');

  if (model === '__custom__') {
    console.log('');
    console.log(`  ${C.dim}Formato: provider/model-name (ex: meta-llama/llama-3.1-8b-instruct)${C.reset}`);
    model = await askRequired(rl, 'ID do modelo');
  }

  console.log('');
  console.log(`  ${C.green}✓${C.reset} Provedor: ${C.bold}${provider.name}${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} Modelo:   ${C.bold}${model}${C.reset}`);

  return {
    providerId: provider.id,
    providerName: provider.name,
    model,
    apiKey,
    baseUrl: provider.baseUrl,
  };
}

async function stepExtras(rl: readline.Interface, mainProviderId: string): Promise<{
  groqKey: string;
  extraKeys: Record<string, string>;
  adminPass: string;
  adminPort: string;
}> {
  sectionHeader(3, 4, '🔑 Configuração Adicional');

  // Groq for STT (Whisper)
  console.log('');
  console.log(`  ${C.cyan}Groq API Key${C.reset} ${C.dim}(recomendado para transcrição de áudio via Whisper)${C.reset}`);
  console.log(`  ${C.dim}Pegue grátis em: https://console.groq.com/keys${C.reset}`);
  console.log('');

  let groqKey = '';
  if (mainProviderId !== 'xai') {
    // xAI doesn't need Groq, but others benefit from it for STT
    groqKey = await ask(rl, 'Groq API Key (ENTER para pular)', '');
  }

  // Extra API keys for fallback
  console.log('');
  console.log(`  ${C.dim}Chaves adicionais para fallback (ENTER para pular):${C.reset}`);
  console.log('');

  const extraKeys: Record<string, string> = {};
  const skipKeys = [
    mainProviderId === 'anthropic' ? 'ANTHROPIC_API_KEY' : '',
    mainProviderId === 'openai' ? 'OPENAI_API_KEY' : '',
    mainProviderId === 'xai' ? 'XAI_API_KEY' : '',
    mainProviderId === 'openrouter' ? 'OPENROUTER_API_KEY' : '',
  ];

  const optionalProviders = [
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)' },
    { key: 'OPENAI_API_KEY', label: 'OpenAI (GPT)' },
    { key: 'XAI_API_KEY', label: 'xAI (Grok)' },
    { key: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
    { key: 'GEMINI_API_KEY', label: 'Google (Gemini)' },
    { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
  ];

  for (const p of optionalProviders) {
    if (skipKeys.includes(p.key)) continue;
    extraKeys[p.key] = await ask(rl, `${p.label} API Key`, '');
  }

  // Admin panel
  console.log('');
  console.log(`  ${C.bold}Painel Admin:${C.reset}`);
  const adminPass = await ask(rl, 'Senha do painel', 'bollaclaw');
  const adminPort = await ask(rl, 'Porta', '3000');

  console.log(`  ${C.green}✓${C.reset} Configuração adicional completa`);

  return { groqKey, extraKeys, adminPass, adminPort };
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // Use /dev/tty when stdin is piped (e.g. curl | bash), otherwise use stdin
  const ttyInput = process.stdin.isTTY
    ? process.stdin
    : fs.createReadStream('/dev/tty');

  const rl = readline.createInterface({
    input: ttyInput,
    output: process.stdout,
  });

  console.log('');
  console.log(`  ${C.cyan}╔${'═'.repeat(48)}╗${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}🤖 BollaClaw V0.1 — Setup Wizard${C.reset}               ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}╠${'═'.repeat(48)}╣${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  Este wizard vai configurar:                   ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}1.${C.reset} Telegram Bot (token + user IDs)            ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}2.${C.reset} Provedor de IA + modelo                    ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}3.${C.reset} API keys adicionais + admin                 ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}4.${C.reset} Identidade e personalidade do agente        ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}╚${'═'.repeat(48)}╝${C.reset}`);
  console.log('');

  // Check existing .env
  if (fs.existsSync(ENV_FILE)) {
    console.log(`  ${C.yellow}⚠${C.reset}  Arquivo .env já existe.`);
    const overwrite = await ask(rl, 'Deseja reconfigurar? (s/n)', 'n');
    if (overwrite.toLowerCase() !== 's') {
      console.log(`  ${C.dim}Mantendo configuração existente.${C.reset}`);
      // Skip to identity onboard
      rl.close();
      const onboard = new OnboardManager();
      if (!onboard.isOnboarded()) {
        await onboard.runInteractiveOnboard();
      }
      showDone();
      return;
    }
  }

  // ── Step 1: Telegram ──
  const telegram = await stepTelegram(rl);

  // ── Step 2: LLM Provider ──
  const provider = await stepProvider(rl);

  // ── Step 3: Extras (Groq STT, fallback keys, admin) ──
  const extras = await stepExtras(rl, provider.providerId);

  // ── Build .env ──
  const mainEnvKey = PROVIDERS.find((p) => p.id === provider.providerId)?.envKey ?? 'ANTHROPIC_API_KEY';

  // Merge all API keys
  const allKeys: Record<string, string> = {
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    XAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    GEMINI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    GROQ_API_KEY: extras.groqKey,
    ...extras.extraKeys,
  };
  allKeys[mainEnvKey] = provider.apiKey;

  const sttProvider = allKeys.GROQ_API_KEY ? 'groq_whisper' : 'none';

  const envContent = `# =============================================
# BollaClaw V0.1 — Environment Configuration
# Generated by onboard wizard on ${new Date().toISOString()}
# =============================================

# ─── Telegram ───
TELEGRAM_BOT_TOKEN=${telegram.botToken}
TELEGRAM_ALLOWED_USER_IDS=${telegram.userIds}

# ─── LLM Provider ───
LLM_PROVIDER=${provider.providerId}
LLM_MODEL=${provider.model}
${provider.baseUrl ? `LLM_BASE_URL=${provider.baseUrl}` : '# LLM_BASE_URL= (using provider default)'}

# ─── API Keys ───
ANTHROPIC_API_KEY=${allKeys.ANTHROPIC_API_KEY}
OPENAI_API_KEY=${allKeys.OPENAI_API_KEY}
XAI_API_KEY=${allKeys.XAI_API_KEY}
OPENROUTER_API_KEY=${allKeys.OPENROUTER_API_KEY}
GEMINI_API_KEY=${allKeys.GEMINI_API_KEY}
DEEPSEEK_API_KEY=${allKeys.DEEPSEEK_API_KEY}
GROQ_API_KEY=${allKeys.GROQ_API_KEY}

# ─── Agent Config ───
MAX_ITERATIONS=5
MEMORY_WINDOW_SIZE=20
SKILLS_DIR=.agents/skills

# ─── Audio (STT/TTS) ───
STT_PROVIDER=${sttProvider}
TTS_VOICE=pt-BR-ThalitaMultilingualNeural
AUTO_AUDIO_REPLY=true

# ─── Admin Panel ───
ADMIN_ENABLED=true
ADMIN_PORT=${extras.adminPort}
ADMIN_PASSWORD=${extras.adminPass}
ADMIN_HOST=0.0.0.0

# ─── Paths ───
DATA_DIR=./data
TMP_DIR=./tmp
LOGS_DIR=./logs

# ─── Logging ───
LOG_LEVEL=info
`;

  fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
  console.log('');
  console.log(`  ${C.green}✅ Arquivo .env criado com sucesso!${C.reset}`);

  // ── Step 4: Identity Onboard ──
  rl.close();
  sectionHeader(4, 4, '🤖 Identidade do Agente');
  const onboard = new OnboardManager();
  await onboard.runInteractiveOnboard();

  showDone();
}

function showDone(): void {
  console.log('');
  console.log(`  ${C.green}╔${'═'.repeat(48)}╗${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  ${C.bold}🚀 BollaClaw — Setup Completo!${C.reset}                 ${C.green}║${C.reset}`);
  console.log(`  ${C.green}╠${'═'.repeat(48)}╣${C.reset}`);
  console.log(`  ${C.green}║${C.reset}                                                ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  O bot será iniciado automaticamente pelo PM2. ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}                                                ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  ${C.bold}pm2 logs bollaclaw${C.reset}   — Ver logs ao vivo        ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  ${C.bold}pm2 restart bollaclaw${C.reset} — Reiniciar              ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  ${C.bold}npm run onboard${C.reset}       — Reconfigurar           ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}                                                ${C.green}║${C.reset}`);
  console.log(`  ${C.green}╚${'═'.repeat(48)}╝${C.reset}`);
  console.log('');
}

main().catch((err) => {
  console.error(`\n  ❌ Erro no wizard: ${err.message}\n`);
  process.exit(1);
});
