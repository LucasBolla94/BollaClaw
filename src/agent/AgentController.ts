import { ProviderFactory } from '../providers/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { MemoryManager } from '../memory/MemoryManager';
import { SkillLoader, Skill } from '../skills/SkillLoader';
import { SkillRouter } from '../skills/SkillRouter';
import { AgentLoop, AgentResult } from './AgentLoop';
import { OnboardManager, IdentityConfig } from '../onboard/OnboardManager';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';

export class AgentController {
  private toolRegistry: ToolRegistry;
  private memoryManager: MemoryManager;
  private skillLoader: SkillLoader;
  private onboardManager: OnboardManager;
  private skills: Skill[] = [];
  private identity: IdentityConfig | null = null;
  private isReady = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.memoryManager = new MemoryManager();
    this.skillLoader = new SkillLoader();
    this.onboardManager = new OnboardManager();
  }

  async initialize(): Promise<void> {
    // Load identity (onboard config)
    this.identity = this.onboardManager.loadIdentity();
    if (this.identity.ownerName) {
      logger.info(`Identity: ${this.identity.agentName} | Owner: ${this.identity.ownerName}`);
    } else {
      logger.warn('No owner configured. Run onboard: npm run onboard');
    }

    // Load skills
    this.skills = this.skillLoader.loadAll();
    this.isReady = true;
    logger.info(`AgentController ready. Skills: ${this.skills.length}, Tools: ${this.toolRegistry.listNames().join(', ')}`);
  }

  private getSystemPrompt(): string {
    if (this.identity && this.identity.ownerName) {
      return this.onboardManager.buildSystemPrompt(this.identity);
    }

    // Fallback: default prompt if no onboard was done
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `Você é o BollaClaw, um assistente pessoal de IA inteligente e prestativo.
Você está rodando em um servidor Ubuntu dedicado e se comunica exclusivamente via Telegram.
Responda sempre em português brasileiro, a menos que o usuário peça outra língua.
Seja conciso, direto e útil. Para tarefas complexas, use as ferramentas disponíveis.
Data/hora atual: ${now}`;
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

    // Build system prompt from identity
    let systemPrompt = this.getSystemPrompt();

    // Route to skill if applicable
    if (this.skills.length > 0) {
      const router = new SkillRouter(ProviderFactory.create('groq') ?? provider);
      const skill = await router.route(userMessage, this.skills);
      if (skill) {
        systemPrompt = `${systemPrompt}\n\n## Active Skill: ${skill.name}\n${skill.content}`;
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

  reloadIdentity(): void {
    this.identity = this.onboardManager.loadIdentity();
    logger.info(`Identity reloaded: ${this.identity.agentName}`);
  }

  getStatus() {
    return {
      ready: this.isReady,
      provider: config.llm.provider,
      agentName: this.identity?.agentName ?? 'BollaClaw',
      owner: this.identity?.ownerName ?? '(not configured)',
      skills: this.skills.map((s) => ({ name: s.name, description: s.description })),
      tools: this.toolRegistry.listNames(),
    };
  }
}
