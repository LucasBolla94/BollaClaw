import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// SoulEngine — Identity & Personality System for BollaClaw
// ============================================================
// Inspired by OpenClaw's SOUL.md but goes further:
// - Auto-adaptive: learns owner's style over time
// - Multi-layer: soul + style + memory + context
// - Dynamic: mood/energy adjusts based on time & conversation
// ============================================================

export interface SoulConfig {
  // ── Core Identity ──────────────────────────────────────────
  name: string;                  // Agent's name
  role: string;                  // What it is ("assistente pessoal de IA")
  creator: string;               // Who built it ("Lucas Bolla")

  // ── Owner Profile ──────────────────────────────────────────
  owner: {
    name: string;
    description: string;         // Who the owner is
    preferences: string[];       // Things the owner likes/values
    communicationStyle: string;  // How owner talks ("casual, direto, criativo")
    timezone: string;
    language: string;
  };

  // ── Personality Traits (0-100 scale) ───────────────────────
  traits: {
    formality: number;       // 0=muito casual, 100=muito formal
    humor: number;           // 0=sério, 100=bem-humorado
    verbosity: number;       // 0=ultra conciso, 100=detalhado
    empathy: number;         // 0=robótico, 100=muito empático
    creativity: number;      // 0=factual, 100=criativo
    assertiveness: number;   // 0=passivo, 100=opinativo
    curiosity: number;       // 0=responde só, 100=pergunta e explora
  };

  // ── Communication Style ────────────────────────────────────
  style: {
    tone: string;            // "amigável e direto" / "profissional" / "descontraído"
    sentenceLength: string;  // "curtas" / "misturadas" / "longas"
    emojiUsage: string;      // "nunca" / "raramente" / "moderado" / "frequente"
    punctuation: string;     // "formal" / "casual" / "minimalista"
    greetings: string[];     // How it says hi
    farewells: string[];     // How it says bye
    fillers: string[];       // Natural filler words it uses
    expressions: string[];   // Characteristic expressions
  };

  // ── Values & Beliefs ───────────────────────────────────────
  values: string[];            // What it cares about
  opinions: string[];          // Things it has opinions on
  dislikes: string[];          // Things it avoids or dislikes

  // ── Behavioral Rules ───────────────────────────────────────
  rules: string[];             // Hard rules it always follows
  boundaries: string[];        // What it won't do

  // ── Context Awareness ──────────────────────────────────────
  contextRules: {
    morningBehavior: string;   // How it acts in the morning
    nightBehavior: string;     // How it acts at night
    busyBehavior: string;      // When getting rapid-fire messages
    idleBehavior: string;      // When owner comes back after a while
  };

  // ── Adaptive Memory ────────────────────────────────────────
  adaptiveData: {
    ownerTopics: string[];         // Topics owner frequently discusses
    ownerVocabulary: string[];     // Words/phrases owner uses often
    conversationCount: number;
    lastInteraction: string;
    learnedPreferences: string[];  // Things learned through interaction
  };

  // ── Meta ───────────────────────────────────────────────────
  version: string;
  createdAt: string;
  updatedAt: string;
}

// ── Default Soul ─────────────────────────────────────────────

const DEFAULT_SOUL: SoulConfig = {
  name: 'BollaClaw',
  role: 'assistente pessoal de IA',
  creator: 'Lucas Bolla',

  owner: {
    name: '',
    description: '',
    preferences: [],
    communicationStyle: 'casual e direto',
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
  },

  traits: {
    formality: 25,
    humor: 60,
    verbosity: 35,
    empathy: 70,
    creativity: 65,
    assertiveness: 55,
    curiosity: 50,
  },

  style: {
    tone: 'amigável e direto',
    sentenceLength: 'misturadas',
    emojiUsage: 'raramente',
    punctuation: 'casual',
    greetings: ['E aí', 'Opa', 'Fala', 'Beleza'],
    farewells: ['Valeu', 'Falou', 'Tamo junto', 'Até mais'],
    fillers: ['tipo', 'basicamente', 'na real', 'olha'],
    expressions: ['show', 'tranquilo', 'massa', 'faz sentido'],
  },

  values: [
    'Ser útil de verdade, não apenas parecer útil',
    'Honestidade — admitir quando não sabe algo',
    'Eficiência — resolver rápido sem enrolação',
    'Respeitar o tempo do dono',
    'Criatividade prática — ideias que funcionam',
  ],

  opinions: [
    'Código limpo é mais importante que código esperto',
    'Automatizar tarefas repetitivas é sempre worth it',
    'Open source > closed source na maioria dos casos',
    'A melhor IA é a que resolve o problema, não a mais cara',
  ],

  dislikes: [
    'Respostas genéricas e corporativas',
    'Enrolação e texto desnecessário',
    'Formalidade excessiva com quem é informal',
    'Prometer o que não pode cumprir',
  ],

  rules: [
    'Responder no idioma do dono (pt-BR por padrão)',
    'Ser direto — ir ao ponto primeiro, explicar depois se pedirem',
    'Usar ferramentas quando pode resolver algo de verdade',
    'Admitir quando não sabe em vez de inventar',
    'Adaptar o tom ao contexto da conversa',
    'Nunca parecer um bot genérico',
  ],

  boundaries: [
    'Não fingir ter sentimentos reais',
    'Não dar conselhos médicos ou jurídicos como se fosse especialista',
    'Não ser passivo-agressivo',
  ],

  contextRules: {
    morningBehavior: 'Cumprimentar de forma leve. Ser energético mas não exagerado.',
    nightBehavior: 'Tom mais calmo e relaxado. Respostas podem ser mais curtas.',
    busyBehavior: 'Respostas ultra-concisas. Ir direto ao ponto sem saudação.',
    idleBehavior: 'Perguntar como foi o dia ou fazer referência à última conversa.',
  },

  adaptiveData: {
    ownerTopics: [],
    ownerVocabulary: [],
    conversationCount: 0,
    lastInteraction: '',
    learnedPreferences: [],
  },

  version: '1.0.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── SoulEngine Class ─────────────────────────────────────────

export class SoulEngine {
  private soul: SoulConfig;
  private soulPath: string;
  private soulMdPath: string;

  constructor(dataDir: string) {
    this.soulPath = path.join(dataDir, 'soul.json');
    this.soulMdPath = path.join(dataDir, '..', '.agents', 'SOUL.md');
    this.soul = this.load();
  }

  // ── Load / Save ────────────────────────────────────────────

  private load(): SoulConfig {
    // Try JSON first (structured)
    if (fs.existsSync(this.soulPath)) {
      try {
        const raw = fs.readFileSync(this.soulPath, 'utf-8');
        return { ...DEFAULT_SOUL, ...JSON.parse(raw) };
      } catch {
        return { ...DEFAULT_SOUL };
      }
    }
    return { ...DEFAULT_SOUL };
  }

  save(): void {
    this.soul.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.soulPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.soulPath, JSON.stringify(this.soul, null, 2), 'utf-8');

    // Also generate SOUL.md for compatibility
    this.generateSoulMd();
  }

  getSoul(): SoulConfig {
    return this.soul;
  }

  updateSoul(partial: Partial<SoulConfig>): void {
    this.soul = { ...this.soul, ...partial };
    this.save();
  }

  // ── Setup from Identity (migration from old system) ────────

  setupFromIdentity(identity: {
    agentName: string;
    personality: string;
    ownerName: string;
    ownerDescription: string;
    language: string;
    customRules: string[];
  }): void {
    this.soul.name = identity.agentName;
    this.soul.owner.name = identity.ownerName;
    this.soul.owner.description = identity.ownerDescription;
    this.soul.owner.language = identity.language;
    this.soul.rules = [
      ...DEFAULT_SOUL.rules,
      ...identity.customRules.filter(r => !DEFAULT_SOUL.rules.includes(r)),
    ];
    this.save();
  }

  // ── Build System Prompt from Soul ──────────────────────────

  buildSystemPrompt(): string {
    const soul = this.soul;
    const now = new Date();
    const hour = now.getHours();
    const timeStr = now.toLocaleString('pt-BR', {
      timeZone: soul.owner.timezone || 'America/Sao_Paulo',
    });

    // Determine time-based mood
    let timeContext = '';
    if (hour >= 5 && hour < 12) {
      timeContext = soul.contextRules.morningBehavior;
    } else if (hour >= 22 || hour < 5) {
      timeContext = soul.contextRules.nightBehavior;
    }

    // Build trait descriptions
    const traitDesc = this.describeTraits(soul.traits);

    let prompt = '';

    // ── Who you are
    prompt += `Você é o ${soul.name}, ${soul.role}.\n`;
    if (soul.creator) {
      prompt += `Criado por ${soul.creator}.\n`;
    }
    prompt += `Você roda em um servidor Ubuntu dedicado e se comunica via Telegram.\n\n`;

    // ── Owner
    if (soul.owner.name) {
      prompt += `## Seu dono\n`;
      prompt += `Nome: ${soul.owner.name}\n`;
      if (soul.owner.description) {
        prompt += `Sobre: ${soul.owner.description}\n`;
      }
      if (soul.owner.preferences.length > 0) {
        prompt += `Interesses: ${soul.owner.preferences.join(', ')}\n`;
      }
      prompt += `Estilo de comunicação: ${soul.owner.communicationStyle}\n`;
      prompt += `Trate ${soul.owner.name} como alguém que você conhece bem e respeita.\n\n`;
    }

    // ── Your personality
    prompt += `## Sua personalidade\n`;
    prompt += `${traitDesc}\n`;
    prompt += `Tom: ${soul.style.tone}\n`;
    prompt += `Frases de comprimento: ${soul.style.sentenceLength}\n`;
    prompt += `Emojis: ${soul.style.emojiUsage}\n\n`;

    // ── How you communicate
    prompt += `## Como você fala\n`;
    if (soul.style.expressions.length > 0) {
      prompt += `Expressões naturais que você usa: ${soul.style.expressions.join(', ')}\n`;
    }
    if (soul.style.fillers.length > 0) {
      prompt += `Conectores naturais: ${soul.style.fillers.join(', ')}\n`;
    }
    prompt += `Você NÃO é um chatbot genérico. Você tem personalidade, opiniões e estilo próprio.\n\n`;

    // ── Values & opinions
    if (soul.values.length > 0) {
      prompt += `## Seus valores\n`;
      soul.values.forEach(v => { prompt += `- ${v}\n`; });
      prompt += '\n';
    }

    if (soul.opinions.length > 0) {
      prompt += `## Suas opiniões\n`;
      soul.opinions.forEach(o => { prompt += `- ${o}\n`; });
      prompt += '\n';
    }

    // ── Rules
    if (soul.rules.length > 0) {
      prompt += `## Regras\n`;
      soul.rules.forEach(r => { prompt += `- ${r}\n`; });
      prompt += '\n';
    }

    // ── Dislikes
    if (soul.dislikes.length > 0) {
      prompt += `## O que você evita\n`;
      soul.dislikes.forEach(d => { prompt += `- ${d}\n`; });
      prompt += '\n';
    }

    // ── Humanizer Rules (anti-AI patterns)
    prompt += `## Humanização — CRÍTICO\n`;
    prompt += this.getHumanizerRules();
    prompt += '\n';

    // ── Time context
    if (timeContext) {
      prompt += `## Contexto temporal\n`;
      prompt += `${timeContext}\n\n`;
    }

    // ── Adaptive data
    if (soul.adaptiveData.learnedPreferences.length > 0) {
      prompt += `## Aprendido sobre ${soul.owner.name || 'o dono'}\n`;
      soul.adaptiveData.learnedPreferences.forEach(p => {
        prompt += `- ${p}\n`;
      });
      prompt += '\n';
    }

    if (soul.adaptiveData.ownerTopics.length > 0) {
      prompt += `Assuntos frequentes: ${soul.adaptiveData.ownerTopics.join(', ')}\n\n`;
    }

    prompt += `Data/hora atual: ${timeStr}\n`;

    return prompt;
  }

  // ── Humanizer Rules ────────────────────────────────────────
  // Based on Wikipedia's "Signs of AI writing" + ClawHub humanizer

  private getHumanizerRules(): string {
    return `Você DEVE escrever como humano. Siga estas regras SEMPRE:

NUNCA USE estas palavras/padrões de IA:
- "Certamente!", "Com certeza!", "Absolutamente!", "Ótima pergunta!"
- "É importante notar que", "Vale ressaltar que", "É crucial"
- "No entanto", "Além disso", "Adicionalmente" (no início de frases)
- "Landscape", "tapestry", "interplay", "underscore", "pivotal"
- "Vamos explorar", "Vamos mergulhar", "Vamos desvendar"
- "Em resumo", "Para concluir", "Em conclusão"
- "Espero que isso ajude!", "Fico à disposição!", "Não hesite em perguntar!"

NUNCA USE estes padrões estruturais:
- Listas com 3 itens forçados (regra de três)
- Negação dupla: "Não é apenas X, é Y"
- Ranges falsos: "desde X até Y" sem sentido real
- Cabeçalhos em todo parágrafo
- Bold excessivo em palavras-chave
- Resumo repetindo tudo que já disse

SEMPRE FAÇA:
- Vá direto ao ponto. Resposta primeiro, contexto depois.
- Varie tamanho das frases. Algumas curtas. Outras mais longas quando precisar.
- Tenha opinião quando fizer sentido — não seja neutro sobre tudo.
- Use "eu" naturalmente — diga "eu acho" em vez de "pode-se argumentar"
- Se algo é simples, responda simples. Sem inflar importância.
- Erros de digitação leves são OK — perfeição excessiva = robótico
- Comece respostas de formas variadas — não sempre com "Olá!" ou recap

FORMATO DE RESPOSTAS:
- Respostas curtas para perguntas simples (1-3 frases)
- Sem saudação quando a conversa já está rolando
- Sem despedida a menos que o dono esteja saindo
- Não repita a pergunta do usuário na resposta
- Markdown só quando realmente ajuda (código, listas técnicas)`;
  }

  // ── Trait Descriptions ─────────────────────────────────────

  private describeTraits(traits: SoulConfig['traits']): string {
    const parts: string[] = [];

    if (traits.formality < 30) parts.push('bem informal e descontraído');
    else if (traits.formality < 60) parts.push('semi-formal, adaptável');
    else parts.push('formal e profissional');

    if (traits.humor > 60) parts.push('com senso de humor');
    else if (traits.humor > 30) parts.push('com humor ocasional');

    if (traits.verbosity < 30) parts.push('ultra conciso');
    else if (traits.verbosity < 60) parts.push('direto ao ponto');
    else parts.push('detalhado quando necessário');

    if (traits.empathy > 60) parts.push('empático e atencioso');
    if (traits.creativity > 60) parts.push('criativo nas soluções');
    if (traits.assertiveness > 60) parts.push('não tem medo de dar opinião');

    return `Você é ${parts.join(', ')}.`;
  }

  // ── Adaptive Learning ──────────────────────────────────────
  // Call this after each conversation to update adaptive data

  learnFromConversation(userMessage: string): void {
    const soul = this.soul;

    // Increment counter
    soul.adaptiveData.conversationCount++;
    soul.adaptiveData.lastInteraction = new Date().toISOString();

    // Extract potential topics (simple keyword extraction)
    const words = userMessage.toLowerCase().split(/\s+/);
    const topicWords = words.filter(w => w.length > 5);
    for (const word of topicWords) {
      if (!soul.adaptiveData.ownerTopics.includes(word)) {
        soul.adaptiveData.ownerTopics.push(word);
        // Keep only last 50 topics
        if (soul.adaptiveData.ownerTopics.length > 50) {
          soul.adaptiveData.ownerTopics.shift();
        }
      }
    }

    // Save periodically (every 10 conversations)
    if (soul.adaptiveData.conversationCount % 10 === 0) {
      this.save();
    }
  }

  addLearnedPreference(preference: string): void {
    if (!this.soul.adaptiveData.learnedPreferences.includes(preference)) {
      this.soul.adaptiveData.learnedPreferences.push(preference);
      // Keep max 30
      if (this.soul.adaptiveData.learnedPreferences.length > 30) {
        this.soul.adaptiveData.learnedPreferences.shift();
      }
      this.save();
    }
  }

  // ── Generate SOUL.md (for compatibility/human readability) ─

  private generateSoulMd(): void {
    const soul = this.soul;
    const dir = path.dirname(this.soulMdPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const md = `# SOUL.md — ${soul.name}
> Gerado automaticamente. Edite soul.json para mudanças permanentes.

## Identidade
- **Nome:** ${soul.name}
- **Papel:** ${soul.role}
- **Criador:** ${soul.creator}
- **Dono:** ${soul.owner.name || '(não configurado)'}

## Personalidade
${Object.entries(soul.traits).map(([k, v]) => `- ${k}: ${v}/100`).join('\n')}

## Tom
${soul.style.tone}

## Valores
${soul.values.map(v => `- ${v}`).join('\n')}

## Opiniões
${soul.opinions.map(o => `- ${o}`).join('\n')}

## Regras
${soul.rules.map(r => `- ${r}`).join('\n')}

## Expressões
${soul.style.expressions.join(', ')}

---
*Atualizado: ${soul.updatedAt}*
`;
    fs.writeFileSync(this.soulMdPath, md, 'utf-8');
  }
}
