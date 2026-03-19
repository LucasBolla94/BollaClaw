import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
// NOTE: Do NOT import logger here — logger imports config which requires
// .env to exist. OnboardManager runs BEFORE .env is created.

export interface IdentityConfig {
  agentName: string;
  personality: string;
  ownerName: string;
  ownerDescription: string;
  language: string;
  customRules: string[];
  createdAt: string;
  version: string;
}

const DEFAULT_IDENTITY: IdentityConfig = {
  agentName: 'BollaClaw',
  personality: 'Sou um assistente pessoal de IA inteligente, prestativo e direto. Respondo com clareza e eficiência.',
  ownerName: '',
  ownerDescription: '',
  language: 'pt-BR',
  customRules: [
    'Sempre responda em português brasileiro, a menos que o usuário peça outra língua.',
    'Seja conciso e direto, mas amigável.',
    'Para tarefas complexas, use as ferramentas disponíveis.',
    'Se não souber algo, admita honestamente.',
  ],
  createdAt: new Date().toISOString(),
  version: '0.1.0',
};

const IDENTITY_FILE = '.agents/identity.json';

export class OnboardManager {
  private identityPath: string;

  constructor(basePath?: string) {
    const base = basePath ?? process.cwd();
    this.identityPath = path.resolve(base, IDENTITY_FILE);
  }

  /**
   * Check if onboarding has been completed
   */
  isOnboarded(): boolean {
    return fs.existsSync(this.identityPath);
  }

  /**
   * Load the identity config from disk
   */
  loadIdentity(): IdentityConfig {
    if (!this.isOnboarded()) {
      console.warn('Identity not found, using defaults');
      return { ...DEFAULT_IDENTITY };
    }

    try {
      const raw = fs.readFileSync(this.identityPath, 'utf-8');
      const data = JSON.parse(raw) as IdentityConfig;
      console.log(`Identity loaded: ${data.agentName} (owner: ${data.ownerName})`);
      return data;
    } catch (err) {
      console.error(`Failed to load identity: ${err}`);
      return { ...DEFAULT_IDENTITY };
    }
  }

  /**
   * Save identity config to disk
   */
  saveIdentity(identity: IdentityConfig): void {
    const dir = path.dirname(this.identityPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.identityPath, JSON.stringify(identity, null, 2), 'utf-8');
    console.log(`Identity saved: ${identity.agentName}`);
  }

  /**
   * Build the system prompt from identity
   */
  buildSystemPrompt(identity: IdentityConfig): string {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    let prompt = `Você é o ${identity.agentName}, ${identity.personality}\n`;
    prompt += `Você está rodando em um servidor Ubuntu dedicado e se comunica via Telegram.\n`;

    if (identity.ownerName) {
      prompt += `\nSeu dono é ${identity.ownerName}.`;
      if (identity.ownerDescription) {
        prompt += ` ${identity.ownerDescription}`;
      }
      prompt += `\nVocê deve tratar ${identity.ownerName} com respeito e atenção especial.\n`;
    }

    if (identity.customRules.length > 0) {
      prompt += `\nRegras de comportamento:\n`;
      identity.customRules.forEach((rule, i) => {
        prompt += `${i + 1}. ${rule}\n`;
      });
    }

    prompt += `\nData/hora atual: ${now}`;
    return prompt;
  }

  /**
   * Interactive CLI onboarding — runs in terminal
   */
  async runInteractiveOnboard(): Promise<IdentityConfig> {
    // Use /dev/tty when stdin is piped (e.g. curl | bash)
    const fs = require('fs');
    const ttyInput = process.stdin.isTTY
      ? process.stdin
      : fs.createReadStream('/dev/tty');

    const rl = readline.createInterface({
      input: ttyInput,
      output: process.stdout,
    });

    const ask = (question: string, defaultVal = ''): Promise<string> => {
      const suffix = defaultVal ? ` [${defaultVal}]` : '';
      return new Promise((resolve) => {
        rl.question(`  ${question}${suffix}: `, (answer) => {
          resolve(answer.trim() || defaultVal);
        });
      });
    };

    console.log('');
    console.log('==========================================');
    console.log(' 🤖 BollaClaw - Onboarding');
    console.log('==========================================');
    console.log('');
    console.log(' Vamos configurar a identidade do seu agente.');
    console.log(' Pressione ENTER para usar o valor padrão [entre colchetes].');
    console.log('');

    const identity: IdentityConfig = { ...DEFAULT_IDENTITY };

    // Agent name
    identity.agentName = await ask(
      'Nome do agente',
      DEFAULT_IDENTITY.agentName
    );

    // Owner name
    identity.ownerName = await ask(
      'Seu nome (dono do agente)',
      ''
    );

    // Owner description
    if (identity.ownerName) {
      identity.ownerDescription = await ask(
        `Descreva brevemente quem é ${identity.ownerName} (opcional)`,
        ''
      );
    }

    // Personality
    console.log('');
    console.log('  Escolha a personalidade do agente:');
    console.log('  1. Profissional e direto');
    console.log('  2. Amigável e casual');
    console.log('  3. Técnico e detalhado');
    console.log('  4. Personalizado');
    console.log('');
    const personalityChoice = await ask('Escolha (1-4)', '1');

    switch (personalityChoice) {
      case '1':
        identity.personality =
          'um assistente pessoal de IA profissional, eficiente e direto. Você foca em entregar resultados claros e práticos.';
        break;
      case '2':
        identity.personality =
          'um assistente pessoal de IA amigável e descontraído. Você é prestativo, usa linguagem casual e mantém um tom leve.';
        break;
      case '3':
        identity.personality =
          'um assistente pessoal de IA técnico e detalhado. Você explica com profundidade, cita fontes quando possível e é meticuloso.';
        break;
      case '4':
        identity.personality = await ask('Descreva a personalidade desejada', DEFAULT_IDENTITY.personality);
        break;
      default:
        identity.personality = DEFAULT_IDENTITY.personality;
    }

    // Language
    identity.language = await ask('Idioma principal (pt-BR, en-US, etc)', 'pt-BR');

    // Custom rules
    console.log('');
    const addRules = await ask('Deseja adicionar regras extras? (s/n)', 'n');
    if (addRules.toLowerCase() === 's') {
      console.log('  Digite uma regra por linha. Linha vazia para terminar.');
      let ruleNum = identity.customRules.length + 1;
      while (true) {
        const rule = await ask(`  Regra ${ruleNum}`, '');
        if (!rule) break;
        identity.customRules.push(rule);
        ruleNum++;
      }
    }

    identity.createdAt = new Date().toISOString();

    // Save
    this.saveIdentity(identity);

    console.log('');
    console.log('==========================================');
    console.log(` ✅ Identidade do ${identity.agentName} configurada!`);
    console.log('==========================================');
    console.log('');

    rl.close();
    return identity;
  }

  /**
   * Quick onboard (non-interactive) with provided values
   */
  quickOnboard(params: Partial<IdentityConfig>): IdentityConfig {
    const identity: IdentityConfig = {
      ...DEFAULT_IDENTITY,
      ...params,
      createdAt: new Date().toISOString(),
    };
    this.saveIdentity(identity);
    return identity;
  }
}
