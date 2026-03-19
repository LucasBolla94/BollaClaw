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
import { telemetry } from '../telemetry/TelemetryReporter';

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
    // Load providers config
    const providersConfig = ProviderFactory.loadConfig();
    const providerList = ProviderFactory.listProviders();
    logger.info(`Providers loaded: ${providerList.map(p => `${p.name}(${p.type}:${p.model})`).join(', ')}`);
    logger.info(`Default provider: ${providersConfig.default} | Router: ${providersConfig.router ?? 'default'}`);

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

  private async loadAndRegisterSkills(): Promise<void> {
    this.skills = this.skillLoader.loadAll();

    for (const skill of this.skills) {
      if (skill.tools.length > 0) {
        for (const toolDef of skill.tools) {
          const scriptTool = new ScriptTool(toolDef, skill.dirPath);
          this.toolRegistry.register(scriptTool);
          logger.info(`Registered skill tool: ${toolDef.name} (from ${skill.name})`);
        }
      }

      if (skill.dependencies) {
        const depsCheck = await this.skillExecutor.checkDependencies(skill);
        if (!depsCheck.ok) {
          logger.warn(`Skill ${skill.name} has missing dependencies: ${depsCheck.missing.join(', ')}`);
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
    const providerName = ProviderFactory.getDefaultName();

    captureLog('info', `Processing [${providerName}] from ${userId}: "${userMessage.substring(0, 80)}"`);

    // Prepare conversation context
    const { conversationId, messages } = this.memoryManager.prepareContext(
      userId,
      userMessage,
      providerName
    );

    // Build system prompt from identity
    let systemPrompt = this.getSystemPrompt();

    // Route to skill if applicable (uses router provider — cheap/fast)
    if (this.skills.length > 0) {
      try {
        const routerProvider = ProviderFactory.createRouter();
        const router = new SkillRouter(routerProvider);
        const skill = await router.route(userMessage, this.skills);

        if (skill) {
          systemPrompt = this.buildSkillPrompt(systemPrompt, skill);
          logger.info(`Using skill: ${skill.name} (executable: ${skill.isExecutable})`);
        }
      } catch (err) {
        logger.warn(`Skill routing failed (using no skill): ${err}`);
      }
    }

    // Add tool names to system prompt
    const toolNames = this.toolRegistry.listNames();
    if (toolNames.length > 0) {
      systemPrompt += `\n\nFerramentas disponíveis: ${toolNames.join(', ')}`;
    }

    // Run agent loop (with fallback if primary provider fails)
    let result: AgentResult;
    const processStart = Date.now();
    try {
      const loop = new AgentLoop(provider, this.toolRegistry);
      result = await loop.run(messages, systemPrompt, requiresAudioReply);
    } catch (err) {
      logger.warn(`Primary provider failed, trying fallback: ${err}`);
      telemetry.trackError(err instanceof Error ? err : new Error(String(err)), 'primary_provider_failed', {
        provider: providerName,
        user_id: userId,
      });
      result = await ProviderFactory.withFallback(async (fallbackProvider) => {
        const loop = new AgentLoop(fallbackProvider, this.toolRegistry);
        return loop.run(messages, systemPrompt, requiresAudioReply);
      });
    }

    // Track message processing
    const processDuration = Date.now() - processStart;
    telemetry.trackMessage(userId, userMessage.length, processDuration, providerName);

    // Persist response
    this.memoryManager.saveAssistantReply(conversationId, result.answer);

    return result;
  }

  private buildSkillPrompt(basePrompt: string, skill: Skill): string {
    let prompt = `${basePrompt}\n\n## Skill Ativa: ${skill.name}\n`;
    prompt += skill.content;

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
    const builtinTools = ['create_file', 'read_file', 'get_datetime'];
    const currentTools = this.toolRegistry.listNames();
    for (const toolName of currentTools) {
      if (!builtinTools.includes(toolName)) {
        this.toolRegistry.unregister(toolName);
      }
    }

    this.loadAndRegisterSkills().then(() => {
      logger.info(`Skills reloaded: ${this.skills.length}`);
    });
  }

  reloadProviders(): void {
    ProviderFactory.loadConfig();
    const providers = ProviderFactory.listProviders();
    logger.info(`Providers reloaded: ${providers.map(p => p.name).join(', ')}`);
  }

  reloadIdentity(): void {
    this.identity = this.onboardManager.loadIdentity();
    logger.info(`Identity reloaded: ${this.identity.agentName}`);
  }

  getStatus() {
    const providers = ProviderFactory.listProviders();
    return {
      ready: this.isReady,
      defaultProvider: ProviderFactory.getDefaultName(),
      providers: providers,
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
