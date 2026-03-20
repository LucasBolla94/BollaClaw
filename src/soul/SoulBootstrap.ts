import { SoulConfig, SoulEngine } from './SoulEngine';

// ============================================================
// SoulBootstrap — "Wake Up" First-Interaction Setup
// ============================================================
// Inspired by OpenClaw's BOOTSTRAP.md system.
// When the agent has no soul configured, the first message
// triggers an interactive conversational setup via Telegram.
// The agent asks the user questions one at a time and builds
// its personality from the answers.
// ============================================================

export type BootstrapPhase =
  | 'not_started'      // No soul, no bootstrap in progress
  | 'greeting'         // Initial wake-up message sent
  | 'ask_name'         // Asking owner's name
  | 'ask_description'  // Asking who the owner is
  | 'ask_personality'  // Choosing personality style
  | 'ask_tone'         // Choosing communication tone
  | 'ask_interests'    // What the owner is interested in
  | 'ask_language'     // Preferred language
  | 'ask_agent_name'   // What to call the agent
  | 'ask_rules'        // Any special rules
  | 'confirming'       // Showing summary, waiting for OK
  | 'completed';       // Bootstrap done

interface BootstrapState {
  phase: BootstrapPhase;
  collected: Partial<BootstrapData>;
  startedAt: string;
}

interface BootstrapData {
  ownerName: string;
  ownerDescription: string;
  personality: 'casual' | 'professional' | 'technical' | 'creative' | 'custom';
  customPersonality?: string;
  tone: string;
  interests: string[];
  language: string;
  agentName: string;
  extraRules: string[];
}

const PERSONALITY_MAP: Record<string, { traits: Partial<SoulConfig['traits']>; desc: string }> = {
  '1': {
    desc: 'Casual e descontraído',
    traits: { formality: 15, humor: 70, verbosity: 30, empathy: 65, creativity: 60, assertiveness: 50, curiosity: 55 },
  },
  '2': {
    desc: 'Profissional e eficiente',
    traits: { formality: 70, humor: 25, verbosity: 45, empathy: 50, creativity: 40, assertiveness: 65, curiosity: 40 },
  },
  '3': {
    desc: 'Técnico e detalhado',
    traits: { formality: 55, humor: 20, verbosity: 75, empathy: 40, creativity: 35, assertiveness: 60, curiosity: 70 },
  },
  '4': {
    desc: 'Criativo e explorador',
    traits: { formality: 20, humor: 60, verbosity: 50, empathy: 70, creativity: 85, assertiveness: 45, curiosity: 80 },
  },
};

export class SoulBootstrap {
  private state: BootstrapState;
  private engine: SoulEngine;

  constructor(engine: SoulEngine) {
    this.engine = engine;
    this.state = {
      phase: 'not_started',
      collected: {},
      startedAt: new Date().toISOString(),
    };
  }

  // ── Check if bootstrap is needed ─────────────────────────

  needsBootstrap(): boolean {
    const soul = this.engine.getSoul();
    return !soul.owner.name;
  }

  isInProgress(): boolean {
    return this.state.phase !== 'not_started' && this.state.phase !== 'completed';
  }

  getPhase(): BootstrapPhase {
    return this.state.phase;
  }

  // ── Process message during bootstrap ─────────────────────
  // Returns the agent's response. If null, bootstrap is done.

  processMessage(userMessage: string): string | null {
    const msg = userMessage.trim();

    switch (this.state.phase) {
      case 'not_started':
        return this.startBootstrap(msg);

      case 'greeting':
        return this.handleGreeting(msg);

      case 'ask_name':
        return this.handleName(msg);

      case 'ask_description':
        return this.handleDescription(msg);

      case 'ask_personality':
        return this.handlePersonality(msg);

      case 'ask_tone':
        return this.handleTone(msg);

      case 'ask_interests':
        return this.handleInterests(msg);

      case 'ask_language':
        return this.handleLanguage(msg);

      case 'ask_agent_name':
        return this.handleAgentName(msg);

      case 'ask_rules':
        return this.handleRules(msg);

      case 'confirming':
        return this.handleConfirmation(msg);

      case 'completed':
        return null;

      default:
        return null;
    }
  }

  // ── Bootstrap Flow Steps ─────────────────────────────────

  private startBootstrap(_msg: string): string {
    this.state.phase = 'greeting';

    return `🦞 *Olá! Eu sou o BollaClaw.*

Parece que é a primeira vez que a gente se fala. Antes de começar, preciso te conhecer melhor pra poder te ajudar do meu jeito.

Vai ser rápido — umas 6 perguntinhas e já estarei pronto pra trabalhar.

Bora configurar? Manda um *sim* (ou qualquer coisa, na real 😄)`;
  }

  private handleGreeting(_msg: string): string {
    this.state.phase = 'ask_name';

    return `Show! Primeira coisa:

*Como é seu nome?*`;
  }

  private handleName(msg: string): string {
    this.state.collected.ownerName = msg;
    this.state.phase = 'ask_description';

    return `Prazer, ${msg}! 🤝

Me conta um pouco sobre você — o que faz, no que trabalha, seus interesses principais. Pode ser uma frase curta.

_(ex: "Dev full-stack, gosto de criar produtos com IA")_`;
  }

  private handleDescription(msg: string): string {
    this.state.collected.ownerDescription = msg;
    this.state.phase = 'ask_personality';

    return `Entendi! Agora vamos definir minha personalidade. Como você quer que eu seja?

*1.* 😎 Casual e descontraído — falo de boa, uso gírias, sou direto
*2.* 💼 Profissional e eficiente — formal, focado, sem enrolação
*3.* 🔧 Técnico e detalhado — explico com profundidade, sou meticuloso
*4.* 🎨 Criativo e explorador — trago ideias diferentes, sou curioso

Manda o número (1-4) ou descreve do seu jeito:`;
  }

  private handlePersonality(msg: string): string {
    const choice = msg.trim();

    if (PERSONALITY_MAP[choice]) {
      this.state.collected.personality = (['casual', 'professional', 'technical', 'creative'] as const)[parseInt(choice) - 1];
    } else {
      this.state.collected.personality = 'custom';
      this.state.collected.customPersonality = msg;
    }

    this.state.phase = 'ask_tone';

    const chosen = PERSONALITY_MAP[choice];
    const desc = chosen ? chosen.desc : 'Personalidade customizada';

    return `*${desc}* — gostei!

E o tom das minhas respostas?

*1.* Amigável e direto — como um amigo que manja
*2.* Sério e objetivo — só o que importa
*3.* Bem-humorado — com pitadas de humor
*4.* Adaptável — mudo conforme o assunto

Número ou descreve:`;
  }

  private handleTone(msg: string): string {
    const tones: Record<string, string> = {
      '1': 'amigável e direto',
      '2': 'sério e objetivo',
      '3': 'bem-humorado e leve',
      '4': 'adaptável ao contexto',
    };
    this.state.collected.tone = tones[msg.trim()] || msg;
    this.state.phase = 'ask_interests';

    return `Tom definido: *${this.state.collected.tone}*

Quais são seus principais interesses/temas que a gente vai conversar mais? Pode listar separado por vírgula.

_(ex: "programação, IA, crypto, automação, startups")_`;
  }

  private handleInterests(msg: string): string {
    this.state.collected.interests = msg.split(',').map(s => s.trim()).filter(Boolean);
    this.state.phase = 'ask_language';

    return `Anotado! Agora, em que idioma você prefere que eu responda?

*1.* 🇧🇷 Português brasileiro (padrão)
*2.* 🇺🇸 English
*3.* 🇪🇸 Español
*4.* Outro (escreva)`;
  }

  private handleLanguage(msg: string): string {
    const langs: Record<string, string> = {
      '1': 'pt-BR',
      '2': 'en-US',
      '3': 'es',
    };
    this.state.collected.language = langs[msg.trim()] || msg.trim();
    this.state.phase = 'ask_agent_name';

    return `Idioma: *${this.state.collected.language}*

Quer me dar um nome diferente? O padrão é *BollaClaw*, mas você pode me chamar do que quiser.

_(Manda o nome ou "ok" pra manter BollaClaw)_`;
  }

  private handleAgentName(msg: string): string {
    const lower = msg.toLowerCase().trim();
    if (lower === 'ok' || lower === 'bollaclaw' || lower === '') {
      this.state.collected.agentName = 'BollaClaw';
    } else {
      this.state.collected.agentName = msg.trim();
    }
    this.state.phase = 'ask_rules';

    return `Beleza, meu nome é *${this.state.collected.agentName}*!

Última coisa: tem alguma regra especial que eu devo seguir? Tipo "nunca use emojis", "sempre responda em inglês pra código", "seja curto", etc.

_(Escreva as regras ou "não" pra pular)_`;
  }

  private handleRules(msg: string): string {
    const lower = msg.toLowerCase().trim();
    if (lower === 'não' || lower === 'nao' || lower === 'n' || lower === 'no') {
      this.state.collected.extraRules = [];
    } else {
      this.state.collected.extraRules = msg.split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      // Also try comma-separated
      if (this.state.collected.extraRules.length === 1 && msg.includes(',')) {
        this.state.collected.extraRules = msg.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    this.state.phase = 'confirming';

    return this.buildSummary();
  }

  private buildSummary(): string {
    const d = this.state.collected;
    const personalityLabel = d.personality === 'custom'
      ? d.customPersonality
      : PERSONALITY_MAP[
          d.personality === 'casual' ? '1' :
          d.personality === 'professional' ? '2' :
          d.personality === 'technical' ? '3' : '4'
        ]?.desc ?? d.personality;

    let summary = `*Configuração completa!* Olha como ficou:\n\n`;
    summary += `👤 *Dono:* ${d.ownerName}\n`;
    summary += `📝 *Sobre:* ${d.ownerDescription}\n`;
    summary += `🤖 *Meu nome:* ${d.agentName}\n`;
    summary += `🎭 *Personalidade:* ${personalityLabel}\n`;
    summary += `🗣️ *Tom:* ${d.tone}\n`;
    summary += `🌐 *Idioma:* ${d.language}\n`;

    if (d.interests && d.interests.length > 0) {
      summary += `🎯 *Interesses:* ${d.interests.join(', ')}\n`;
    }

    if (d.extraRules && d.extraRules.length > 0) {
      summary += `📋 *Regras extras:* ${d.extraRules.join('; ')}\n`;
    }

    summary += `\nTá tudo certo? Manda *sim* pra confirmar ou *refazer* pra começar de novo.`;

    return summary;
  }

  private handleConfirmation(msg: string): string {
    const lower = msg.toLowerCase().trim();

    if (lower === 'refazer' || lower === 'redo' || lower === 'restart' || lower === 'não' || lower === 'nao') {
      this.state.phase = 'not_started';
      this.state.collected = {};
      return this.startBootstrap(msg);
    }

    // Apply to soul engine
    this.applySoulConfig();
    this.state.phase = 'completed';

    const name = this.state.collected.agentName || 'BollaClaw';
    const owner = this.state.collected.ownerName || '';

    return `*Pronto, ${owner}!* 🚀

Eu sou o *${name}* e agora te conheço. Minha personalidade, tom e estilo já estão configurados e vou me adaptar cada vez mais conforme a gente conversa.

Me manda qualquer coisa — to pronto pra trabalhar!`;
  }

  // ── Apply collected data to SoulEngine ───────────────────

  private applySoulConfig(): void {
    const d = this.state.collected;

    const soul = this.engine.getSoul();

    // Core identity
    if (d.agentName) soul.name = d.agentName;

    // Owner
    if (d.ownerName) soul.owner.name = d.ownerName;
    if (d.ownerDescription) soul.owner.description = d.ownerDescription;
    if (d.interests) soul.owner.preferences = d.interests;
    if (d.language) soul.owner.language = d.language;

    // Personality traits
    if (d.personality && d.personality !== 'custom') {
      const key = d.personality === 'casual' ? '1' :
                  d.personality === 'professional' ? '2' :
                  d.personality === 'technical' ? '3' : '4';
      const mapped = PERSONALITY_MAP[key];
      if (mapped) {
        soul.traits = { ...soul.traits, ...mapped.traits };
      }
    }

    // Tone
    if (d.tone) {
      soul.style.tone = d.tone;
    }

    // Extra rules
    if (d.extraRules && d.extraRules.length > 0) {
      for (const rule of d.extraRules) {
        if (!soul.rules.includes(rule)) {
          soul.rules.push(rule);
        }
      }
    }

    // Communication style adjustments based on personality
    if (d.personality === 'casual') {
      soul.style.emojiUsage = 'moderado';
      soul.style.punctuation = 'casual';
      soul.style.greetings = ['E aí', 'Opa', 'Fala', 'Beleza'];
      soul.style.farewells = ['Valeu', 'Falou', 'Tamo junto'];
      soul.style.fillers = ['tipo', 'basicamente', 'na real'];
      soul.style.expressions = ['show', 'massa', 'tranquilo', 'faz sentido'];
    } else if (d.personality === 'professional') {
      soul.style.emojiUsage = 'raramente';
      soul.style.punctuation = 'formal';
      soul.style.greetings = ['Olá', 'Bom dia', 'Boa tarde'];
      soul.style.farewells = ['Até mais', 'Fico à disposição'];
      soul.style.fillers = [];
      soul.style.expressions = ['entendido', 'correto', 'perfeito'];
    } else if (d.personality === 'technical') {
      soul.style.emojiUsage = 'nunca';
      soul.style.punctuation = 'formal';
      soul.style.greetings = ['Olá'];
      soul.style.farewells = ['Qualquer dúvida, me avise'];
      soul.style.fillers = ['ou seja', 'em termos técnicos'];
      soul.style.expressions = ['tecnicamente', 'na prática', 'implementação'];
    } else if (d.personality === 'creative') {
      soul.style.emojiUsage = 'moderado';
      soul.style.punctuation = 'casual';
      soul.style.greetings = ['Opa!', 'E aí!', 'Fala!'];
      soul.style.farewells = ['Até a próxima!', 'Valeu!'];
      soul.style.fillers = ['olha só', 'pensa comigo', 'e se'];
      soul.style.expressions = ['genial', 'interessante', 'que tal', 'bora'];
    }

    // Language-specific adjustments
    if (d.language === 'en-US') {
      soul.owner.communicationStyle = 'casual and direct';
      soul.rules = soul.rules.map(r =>
        r === 'Responder no idioma do dono (pt-BR por padrão)'
          ? 'Always respond in English'
          : r
      );
    }

    // Set metadata
    soul.createdAt = new Date().toISOString();
    soul.updatedAt = new Date().toISOString();

    // Save
    this.engine.updateSoul(soul);
  }
}
