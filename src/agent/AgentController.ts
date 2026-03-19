import { ProviderFactory } from '../providers/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ScriptTool } from '../tools/ScriptTool';
import { MemoryManager } from '../memory/MemoryManager';
import { SkillLoader, Skill } from '../skills/SkillLoader';
import { SkillRouter } from '../skills/SkillRouter';
import { SkillExecutor } from '../skills/SkillExecutor';
import { AgentLoop, AgentResult } from './AgentLoop';
import { OnboardManager, IdentityConfig } from '../onboard/OnboardManager';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';

export class AgentController {
  private toolRegistry: ToolRegistry;
  private memoryManager: MemoryManager;
  private skillLoader: SkillLoader;
  private skillExecutor: SkillExecutor;
  private onboardManager: OnboardManager;
  private skills: Skill[] = [];
  private identity: IdentityConfig | null = null;
  private isReady = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.memoryManager = new MemoryManager();
    this.skillLoader = new SkillLoader();
    this.skillExecutor = new SkillExecutor();
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

    // Load skills + register their tools
    await this.loadAndRegisterSkills();

    this.isReady = true;
    logger.info(`AgentController ready. Skills: ${this.skills.length}, Tools: ${this.toolRegistry.listNames().join(', ')}`);
  }

  /**
   * Load all skills and register their custom tools in the ToolRegistry
   */
  private async loadAndRegisterSkills(): Promise<void> {
    this.skills = this.skillLoader.loadAll();

    for (const skill of this.skills) {
      // Register custom tools defined by the skill
      if (skill.tools.length > 0) {
        for (const toolDef of skill.tools) {
          const scriptTool = new ScriptTool(toolDef, skill.dirPath);
          this.toolRegistry.register(scriptTool);
          logger.info(`Registered skill tool: ${toolDef.name} (from ${skill.name})`);
        }
      }

      // Install dependencies if needed (runs once)
      if (skill.dependencies) {
        const depsCheck = await this.skillExecutor.checkDependencies(skill);
        if (!depsCheck.ok) {
          logger.warn(`Skill ${skill.name} has missing dependencies: ${depsCheck.missing.join(', ')}`);
          // Auto-install on first load
          await this.skillLoader.installDependencies(skill);
        }
      }
    }
  }

  private getSystemPrompt(): string {
    if (this.identity && this.identity.ownerName) {
      return this.onboardManager.buildSystemPrompt(this.identity);
    }

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
        systemPrompt = this.buildSkillPrompt(systemPrompt, skill);
        logger.info(`Using skill: ${skill.name} (executable: ${skill.isExecutable})`);
      }
    }

    // Add tool names to system prompt
    const toolNames = this.toolRegistry.listNames();
    if (toolNames.length > 0) {
      systemPrompt += `\n\nFerramentas disponíveis: ${toolNames.join(', ')}`;
    }

    // Run agent loop
    const loop = new AgentLoop(provider, this.toolRegistry);
    const result = await loop.run(messages, systemPrompt, requiresAudioReply);

    // Persist response
    this.memoryManager.saveAssistantReply(conversationId, result.answer);

    return result;
  }

  /**
   * Build the enhanced system prompt when a skill is active
   */
  private buildSkillPrompt(basePrompt: string, skill: Skill): string {
    let prompt = `${basePrompt}\n\n## Skill Ativa: ${skill.name}\n`;

    // Inject skill instructions
    prompt += skill.content;

    // If skill is executable, tell the agent about its capabilities
    if (skill.isExecutable) {
      prompt += `\n\n### Execução\n`;
      prompt += `Esta skill tem scripts executáveis (runtime: ${skill.runtime ?? 'auto'}).\n`;

      if (skill.tools.length > 0) {
        prompt += `\nFerramentas desta skill:\n`;
        for (const tool of skill.tools) {
          prompt += `- **${tool.name}**: ${tool.description}\n`;
        }
        prompt += `\nUse estas ferramentas quando a tarefa exigir. Elas executam scripts reais no servidor.\n`;
      }

      if (skill.api?.baseUrl) {
        prompt += `\nAPI base: ${skill.api.baseUrl}\n`;
      }
    }

    return prompt;
  }

  reloadSkills(): void {
    // Unregister old skill tools (keep only built-in)
    const builtinTools = ['create_file', 'read_file', 'get_datetime'];
    const currentTools = this.toolRegistry.listNames();
    for (const toolName of currentTools) {
      if (!builtinTools.includes(toolName)) {
        this.toolRegistry.unregister(toolName);
      }
    }

    // Reload and re-register
    this.loadAndRegisterSkills().then(() => {
      logger.info(`Skills reloaded: ${this.skills.length}`);
    });
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
      skills: this.skills.map((s) => ({
        name: s.name,
        description: s.description,
        executable: s.isExecutable,
        tools: s.tools.map((t) => t.name),
        runtime: s.runtime,
      })),
      tools: this.toolRegistry.listNames(),
    };
  }
}
