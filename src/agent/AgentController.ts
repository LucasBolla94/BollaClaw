import { ProviderFactory } from '../providers/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { MemoryManager } from '../memory/MemoryManager';
import { SkillLoader, Skill } from '../skills/SkillLoader';
import { SkillRouter } from '../skills/SkillRouter';
import { AgentLoop, AgentResult } from './AgentLoop';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';

const BASE_SYSTEM_PROMPT = `Você é o BollaClaw, um assistente pessoal de IA inteligente e prestativo.
Você está rodando em um servidor Ubuntu dedicado e se comunica exclusivamente via Telegram.
Responda sempre em português brasileiro, a menos que o usuário peça outra língua.
Seja conciso, direto e útil. Para tarefas complexas, use as ferramentas disponíveis.
Data/hora atual: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

export class AgentController {
  private toolRegistry: ToolRegistry;
  private memoryManager: MemoryManager;
  private skillLoader: SkillLoader;
  private skills: Skill[] = [];
  private isReady = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.memoryManager = new MemoryManager();
    this.skillLoader = new SkillLoader();
  }

  async initialize(): Promise<void> {
    this.skills = this.skillLoader.loadAll();
    this.isReady = true;
    logger.info(`AgentController ready. Skills: ${this.skills.length}, Tools: ${this.toolRegistry.listNames().join(', ')}`);
  }

  async process(
    userId: string,
    userMessage: string,
    requiresAudioReply = false
  ): Promise<AgentResult> {
    if (!this.isReady) await this.initialize();

    const provider = ProviderFactory.create();
    const providerName = config.llm.provider;

    captureLog('info', `Processing message from ${userId}: "${userMessage.substring(0, 80)}"`);

    // Prepare conversation context
    const { conversationId, messages } = this.memoryManager.prepareContext(
      userId,
      userMessage,
      providerName
    );

    // Route to skill if applicable
    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (this.skills.length > 0) {
      const router = new SkillRouter(ProviderFactory.create('groq') ?? provider);
      const skill = await router.route(userMessage, this.skills);
      if (skill) {
        systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n## Active Skill: ${skill.name}\n${skill.content}`;
        logger.info(`Using skill: ${skill.name}`);
      }
    }

    // Add tool names to system prompt
    const toolNames = this.toolRegistry.listNames();
    if (toolNames.length > 0) {
      systemPrompt += `\n\nAvailable tools: ${toolNames.join(', ')}`;
    }

    // Run agent loop
    const loop = new AgentLoop(provider, this.toolRegistry);
    const result = await loop.run(messages, systemPrompt, requiresAudioReply);

    // Persist response
    this.memoryManager.saveAssistantReply(conversationId, result.answer);

    return result;
  }

  reloadSkills(): void {
    this.skills = this.skillLoader.loadAll();
    logger.info(`Skills reloaded: ${this.skills.length}`);
  }

  getStatus() {
    return {
      ready: this.isReady,
      provider: config.llm.provider,
      skills: this.skills.map((s) => ({ name: s.name, description: s.description })),
      tools: this.toolRegistry.listNames(),
    };
  }
}
