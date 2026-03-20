#!/usr/bin/env node
/**
 * BollaClaw Onboard CLI — Interactive Setup Wizard
 * Arrow-key navigation, no number typing needed.
 *
 * Run: node dist/onboard/cli.js
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const ENV_FILE = path.resolve(process.cwd(), '.env');

// ─── TTY input (works even when piped via curl | bash) ───
function getTTY(): fs.ReadStream | NodeJS.ReadStream {
  if (process.stdin.isTTY) return process.stdin;
  return fs.createReadStream('/dev/tty');
}

// ─── ANSI helpers ────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  clearLine: '\x1b[2K',
  up: (n: number) => `\x1b[${n}A`,
};

function sectionHeader(num: number, total: number, title: string): void {
  console.log('');
  console.log(`  ${C.bold}${C.yellow}[${num}/${total}]${C.reset} ${C.bold}${title}${C.reset}`);
  console.log(`  ${'─'.repeat(48)}`);
}

// ─── Arrow-key menu selector ─────────────────────────────
interface MenuOption {
  label: string;
  value: string;
  desc?: string;
}

function arrowSelect(options: MenuOption[], title = 'Selecione uma opção'): Promise<string> {
  return new Promise((resolve) => {
    const tty = getTTY() as any;
    const isRawCapable = typeof tty.setRawMode === 'function';

    // Fallback: if raw mode not supported, use simple number input
    if (!isRawCapable) {
      const rl = readline.createInterface({ input: tty, output: process.stdout });
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const desc = opt.desc ? ` ${C.dim}— ${opt.desc}${C.reset}` : '';
        console.log(`  ${C.bold}${i + 1}.${C.reset} ${opt.label}${desc}`);
      }
      rl.question(`\n  ${title} (1-${options.length}) [1]: `, (ans) => {
        rl.close();
        const idx = Math.max(0, Math.min(options.length - 1, (parseInt(ans, 10) || 1) - 1));
        resolve(options[idx].value);
      });
      return;
    }

    let selected = 0;
    const pageSize = Math.min(options.length, process.stdout.rows ? process.stdout.rows - 6 : 15);

    function getScrollOffset(): number {
      if (options.length <= pageSize) return 0;
      const half = Math.floor(pageSize / 2);
      let offset = selected - half;
      offset = Math.max(0, Math.min(options.length - pageSize, offset));
      return offset;
    }

    function render(initial = false): void {
      const offset = getScrollOffset();
      const visible = options.slice(offset, offset + pageSize);

      if (!initial) {
        // Move cursor up to overwrite previous render
        process.stdout.write(C.up(pageSize + (options.length > pageSize ? 1 : 0)));
      }

      for (let i = 0; i < visible.length; i++) {
        const globalIdx = offset + i;
        const opt = visible[i];
        const desc = opt.desc ? ` ${C.dim}— ${opt.desc}${C.reset}` : '';
        const prefix = globalIdx === selected
          ? `${C.green}${C.bold}  ► `
          : '    ';
        const suffix = globalIdx === selected ? C.reset : '';
        process.stdout.write(`${C.clearLine}${prefix}${opt.label}${suffix}${desc}\n`);
      }

      if (options.length > pageSize) {
        const scrollInfo = `${C.dim}  ↑↓ para navegar (${selected + 1}/${options.length})${C.reset}`;
        process.stdout.write(`${C.clearLine}${scrollInfo}\n`);
      }
    }

    process.stdout.write(C.hide);
    console.log(`  ${C.dim}Use ↑↓ para navegar, ENTER para confirmar${C.reset}`);
    console.log('');
    render(true);

    tty.setRawMode(true);
    tty.resume();

    function onKey(key: Buffer): void {
      const s = key.toString();

      // Arrow up
      if (s === '\x1b[A') {
        selected = selected > 0 ? selected - 1 : options.length - 1;
        render();
        return;
      }
      // Arrow down
      if (s === '\x1b[B') {
        selected = selected < options.length - 1 ? selected + 1 : 0;
        render();
        return;
      }
      // Enter
      if (s === '\r' || s === '\n') {
        cleanup();
        process.stdout.write(C.show);
        console.log(`  ${C.green}✓${C.reset} ${options[selected].label}`);
        resolve(options[selected].value);
        return;
      }
      // Ctrl+C
      if (s === '\x03') {
        cleanup();
        process.stdout.write(C.show);
        process.exit(0);
      }
    }

    function cleanup(): void {
      tty.removeListener('data', onKey);
      tty.setRawMode(false);
      tty.pause();
    }

    tty.on('data', onKey);
  });
}

// ─── Simple text input ───────────────────────────────────
function ask(question: string, defaultVal = ''): Promise<string> {
  const tty = getTTY();
  const rl = readline.createInterface({ input: tty, output: process.stdout });
  const suffix = defaultVal ? ` ${C.dim}[${defaultVal}]${C.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

function askRequired(question: string): Promise<string> {
  return new Promise((resolve) => {
    const doAsk = () => {
      const tty = getTTY();
      const rl = readline.createInterface({ input: tty, output: process.stdout });
      rl.question(`  ${question}: `, (answer) => {
        rl.close();
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

function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  return new Promise(async (resolve) => {
    const hint = defaultYes ? 'S/n' : 's/N';
    const ans = await ask(`${question} (${hint})`, defaultYes ? 's' : 'n');
    resolve(ans.toLowerCase() === 's');
  });
}

// ═══════════════════════════════════════════════════════════
// Provider + Model definitions
// ═══════════════════════════════════════════════════════════

interface ProviderGroup {
  id: string;
  name: string;
  envKey: string;
  baseUrl?: string;
  models: MenuOption[];
  allowCustomModel?: boolean;
}

const PROVIDERS: ProviderGroup[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { label: 'Claude Opus 4.6', value: 'claude-opus-4-6', desc: 'Mais inteligente — $5/$25 MTok' },
      { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6', desc: 'Melhor custo-benefício — $3/$15 MTok' },
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5', desc: 'Mais rápido e barato — $1/$5 MTok' },
      { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5', desc: 'Versão anterior — estável' },
      { label: 'Claude Opus 4.5', value: 'claude-opus-4-5', desc: 'Versão anterior — premium' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (ChatGPT / Codex)',
    envKey: 'OPENAI_API_KEY',
    models: [
      { label: 'GPT-5.4', value: 'gpt-5.4', desc: 'Flagship — coding + raciocínio' },
      { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini', desc: 'Rápido e econômico' },
      { label: 'GPT-5.3 Codex', value: 'gpt-5.3-codex', desc: 'Otimizado para coding' },
      { label: 'GPT-4o', value: 'gpt-4o', desc: 'Multimodal — texto, imagem, áudio' },
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini', desc: 'Rápido e barato' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    envKey: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      { label: 'Grok 4', value: 'grok-4', desc: 'Raciocínio profundo' },
      { label: 'Grok 4 Fast', value: 'grok-4-fast', desc: 'Rápido com raciocínio' },
      { label: 'Grok 4.1 Fast', value: 'grok-4-1-fast', desc: 'Agent tools optimized' },
      { label: 'Grok Code Fast', value: 'grok-code-fast-1', desc: 'Coding — 256K context' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (Multi-Modelo)',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    allowCustomModel: true,
    models: [
      { label: 'Claude Opus 4.6', value: 'anthropic/claude-opus-4-6', desc: 'Anthropic — melhor agente' },
      { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4-6', desc: 'Anthropic — custo-benefício' },
      { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5', desc: 'Anthropic — barato' },
      { label: 'GPT-5.4', value: 'openai/gpt-5.4', desc: 'OpenAI — flagship' },
      { label: 'GPT-5.4 Mini', value: 'openai/gpt-5.4-mini', desc: 'OpenAI — econômico' },
      { label: 'GPT-4o', value: 'openai/gpt-4o', desc: 'OpenAI — multimodal' },
      { label: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro', desc: 'Google — raciocínio' },
      { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash', desc: 'Google — rápido' },
      { label: 'Grok 4', value: 'x-ai/grok-4', desc: 'xAI — raciocínio profundo' },
      { label: 'Grok 4.1 Fast', value: 'x-ai/grok-4-1-fast', desc: 'xAI — rápido' },
      { label: 'DeepSeek V3', value: 'deepseek/deepseek-chat-v3-0324', desc: '1/50x custo' },
      { label: 'DeepSeek R1', value: 'deepseek/deepseek-r1', desc: 'Raciocínio profundo' },
      { label: 'Llama 4 Maverick', value: 'meta-llama/llama-4-maverick', desc: 'Meta — MoE' },
      { label: 'Llama 3.3 70B', value: 'meta-llama/llama-3.3-70b-instruct', desc: 'Meta — gratuito' },
      { label: 'Qwen3 Coder', value: 'qwen/qwen3-coder', desc: 'Alibaba — coding' },
      { label: 'Qwen3 235B', value: 'qwen/qwen3-235b-a22b', desc: 'Alibaba — forte' },
      { label: 'Mistral Large 2', value: 'mistralai/mistral-large-2', desc: 'Mistral' },
      { label: 'Codestral', value: 'mistralai/codestral-latest', desc: 'Mistral — coding' },
      { label: 'Hermes 3 405B', value: 'nousresearch/hermes-3-llama-3.1-405b', desc: 'Open-source' },
      { label: 'Auto (OpenRouter)', value: 'openrouter/auto', desc: 'Automático por prompt' },
      { label: '✏️  Modelo personalizado', value: '__custom__', desc: 'Digite manualmente' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Main wizard flow
// ═══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('');
  console.log(`  ${C.cyan}╔${'═'.repeat(48)}╗${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}🤖 BollaClaw V0.1 — Setup Wizard${C.reset}               ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}╠${'═'.repeat(48)}╣${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  Este wizard vai configurar:                   ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}1.${C.reset} Telegram Bot Token + User IDs              ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}2.${C.reset} Provedor de IA → Modelo → API Key          ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}  ${C.bold}3.${C.reset} Whisper STT (transcrição de áudio)         ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}║${C.reset}                                                ${C.cyan}║${C.reset}`);
  console.log(`  ${C.cyan}╚${'═'.repeat(48)}╝${C.reset}`);
  console.log('');

  // Check existing .env
  if (fs.existsSync(ENV_FILE)) {
    console.log(`  ${C.yellow}⚠${C.reset}  Configuração já existe.`);
    const overwrite = await askYesNo('Deseja reconfigurar?', false);
    if (!overwrite) {
      console.log(`  ${C.dim}Mantendo configuração existente.${C.reset}`);
      return;
    }
  }

  // ════════════════════════════════════════════════════════
  // STEP 1: Telegram
  // ════════════════════════════════════════════════════════
  sectionHeader(1, 3, '📱 Telegram Bot');

  console.log('');
  console.log(`  Crie um bot via ${C.cyan}@BotFather${C.reset} no Telegram`);
  console.log(`  e cole o token aqui.`);
  console.log('');

  const botToken = await askRequired(`Bot Token`);

  console.log('');
  console.log(`  Envie /start para ${C.cyan}@userinfobot${C.reset} para saber seu ID.`);
  console.log(`  Separe múltiplos IDs por vírgula.`);
  console.log('');

  const userIds = await askRequired('User ID(s) permitidos');
  console.log(`  ${C.green}✓${C.reset} Telegram configurado`);

  // ════════════════════════════════════════════════════════
  // STEP 2: Provider → Model → API Key
  // ════════════════════════════════════════════════════════
  sectionHeader(2, 3, '🧠 Provedor de IA');

  console.log('');
  console.log(`  ${C.bold}Escolha o provedor:${C.reset}`);
  console.log('');

  const providerOptions: MenuOption[] = PROVIDERS.map((p) => ({
    label: p.name,
    value: p.id,
  }));

  const providerId = await arrowSelect(providerOptions, 'Provedor');
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  // Model selection
  console.log('');
  console.log(`  ${C.bold}Escolha o modelo:${C.reset}`);
  console.log('');

  let model = await arrowSelect(provider.models, 'Modelo');

  if (model === '__custom__') {
    console.log('');
    console.log(`  ${C.dim}Formato: provider/model-name (ex: meta-llama/llama-3.1-8b-instruct)${C.reset}`);
    model = await askRequired('ID do modelo');
  }

  // API Key
  console.log('');
  const apiKey = await askRequired(`API Key do ${provider.name}`);

  console.log('');
  console.log(`  ${C.green}✓${C.reset} Provedor: ${C.bold}${provider.name}${C.reset}`);
  console.log(`  ${C.green}✓${C.reset} Modelo:   ${C.bold}${model}${C.reset}`);

  // ════════════════════════════════════════════════════════
  // STEP 3: Whisper STT (local, CPU-only)
  // ════════════════════════════════════════════════════════
  sectionHeader(3, 3, '🎤 Transcrição de Áudio (Whisper)');

  console.log('');
  console.log(`  O BollaClaw pode transcrever áudios do Telegram`);
  console.log(`  usando Whisper localmente (sem GPU, sem API externa).`);
  console.log(`  Suporta: ${C.bold}pt-BR${C.reset} e ${C.bold}en${C.reset}`);
  console.log(`  Modelo: whisper-base (~150MB RAM)`);
  console.log('');

  const installWhisper = await askYesNo('Instalar Whisper local para transcrição?', true);

  let sttProvider = 'none';
  if (installWhisper) {
    sttProvider = 'local_whisper';
    console.log(`  ${C.green}✓${C.reset} Whisper local será instalado`);
  } else {
    console.log(`  ${C.dim}Whisper desabilitado. Pode ativar depois com: npm run onboard${C.reset}`);
  }

  // ════════════════════════════════════════════════════════
  // Build .env
  // ════════════════════════════════════════════════════════
  const allKeys: Record<string, string> = {
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    XAI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    GEMINI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    GROQ_API_KEY: '',
  };
  allKeys[provider.envKey] = apiKey;

  const envContent = `# =============================================
# BollaClaw V0.1 — Environment Configuration
# Generated on ${new Date().toISOString()}
# =============================================

# ─── Telegram ───
TELEGRAM_BOT_TOKEN=${botToken}
TELEGRAM_ALLOWED_USER_IDS=${userIds}

# ─── LLM Provider ───
LLM_PROVIDER=${providerId}
LLM_MODEL=${model}
${provider.baseUrl ? `LLM_BASE_URL=${provider.baseUrl}` : '# LLM_BASE_URL='}

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
WHISPER_MODEL=base
TTS_VOICE=pt-BR-ThalitaMultilingualNeural
AUTO_AUDIO_REPLY=true

# ─── Admin Panel ───
ADMIN_ENABLED=true
ADMIN_PORT=21086
ADMIN_PASSWORD=bollaclaw
ADMIN_HOST=0.0.0.0

# ─── Paths ───
DATA_DIR=./data
TMP_DIR=./tmp
LOGS_DIR=./logs

# ─── Logging ───
LOG_LEVEL=info

# ─── Telemetry (BollaWatch) ───
# URL do BollaWatch para envio de telemetria.
# Para desabilitar, coloque: disabled
BOLLAWATCH_URL=http://server2.bolla.network:21087
`;

  fs.writeFileSync(ENV_FILE, envContent, 'utf-8');

  console.log('');
  console.log(`  ${C.green}✅ Configuração salva!${C.reset}`);
  console.log('');
  console.log(`  ${C.green}╔${'═'.repeat(48)}╗${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  ${C.bold}🚀 BollaClaw — Setup Completo!${C.reset}                 ${C.green}║${C.reset}`);
  console.log(`  ${C.green}╠${'═'.repeat(48)}╣${C.reset}`);
  console.log(`  ${C.green}║${C.reset}                                                ${C.green}║${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  Provedor:  ${C.bold}${provider.name}${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  Modelo:    ${C.bold}${model}${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  Whisper:   ${C.bold}${installWhisper ? 'Local (CPU)' : 'Desabilitado'}${C.reset}`);
  console.log(`  ${C.green}║${C.reset}  Admin:     ${C.bold}http://IP:21086${C.reset}`);
  console.log(`  ${C.green}║${C.reset}                                                ${C.green}║${C.reset}`);
  console.log(`  ${C.green}╚${'═'.repeat(48)}╝${C.reset}`);
  console.log('');

  // Force clean exit
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(C.show);
  console.error(`\n  ❌ Erro no wizard: ${err.message}\n`);
  process.exit(1);
});
