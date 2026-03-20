import { ProviderFactory } from '../providers/ProviderFactory';
import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ScriptTool } from '../tools/ScriptTool';
import { MemoryManager } from '../memory/MemoryManager';
import { SkillLoader, Skill } from '../skills/SkillLoader';
import { SkillRouter } from '../skills/SkillRouter';
import { SkillExecutor } from '../skills/SkillExecutor';
import { SkillInstaller } from '../skills/SkillInstaller';
import { AgentLoop, AgentResult } from './AgentLoop';
import { ThinkingEngine } from './ThinkingEngine';
import { HookManager, createDefaultHookManager } from '../hooks/HookManager';
import { AgentOrchestrator } from '../orchestrator/AgentOrchestrator';
import { OnboardManager, IdentityConfig } from '../onboard/OnboardManager';
import { SoulEngine } from '../soul/SoulEngine';
import { SoulBootstrap } from '../soul/SoulBootstrap';
import { config } from '../utils/config';
import { logger, captureLog } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

export class AgentController {
  private toolRegistry: ToolRegistry;
  private memoryManager: MemoryManager;
  private skillLoader: SkillLoader;
  private skillExecutor: SkillExecutor;
  private skillInstaller: SkillInstaller;
  private orchestrator: AgentOrchestrator;
  private thinkingEngine: ThinkingEngine;
  private hookManager: HookManager;
  private onboardManager: OnboardManager;
  private soulEngine: SoulEngine;
  private soulBootstrap: SoulBootstrap;
  private skills: Skill[] = [];
  private identity: IdentityConfig | null = null;
  private isReady = false;

  constructor() {
    this.toolRegistry = new ToolRegistry();
    this.memoryManager = new MemoryManager();
    this.skillLoader = new SkillLoader();
    this.skillExecutor = new SkillExecutor();
    this.skillInstaller = new SkillInstaller();
    this.orchestrator = new AgentOrchestrator(this.toolRegistry);
    this.thinkingEngine = new ThinkingEngine(); // Adaptive mode by default
    this.hookManager = createDefaultHookManager();
    this.onboardManager = new OnboardManager();

    // Soul system — data dir is ./data relative to cwd
    const dataDir = require('path').resolve(process.cwd(), 'data');
    this.soulEngine = new SoulEngine(dataDir);
    this.soulBootstrap = new SoulBootstrap(this.soulEngine);
  }

  async initialize(): Promise<void> {
    // Load providers config
    const providersConfig = ProviderFactory.loadConfig();
    const providerList = ProviderFactory.listProviders();
    logger.info(`Providers loaded: ${providerList.map(p => `${p.name}(${p.type}:${p.model})`).join(', ')}`);
    logger.info(`Default provider: ${providersConfig.default} | Router: ${providersConfig.router ?? 'default'}`);

    // Load identity (onboard config) — legacy support
    this.identity = this.onboardManager.loadIdentity();

    // Migrate old identity to Soul system if soul is empty but identity exists
    if (this.soulBootstrap.needsBootstrap() && this.identity.ownerName) {
      logger.info('Migrating legacy identity to Soul system...');
      this.soulEngine.setupFromIdentity({
        agentName: this.identity.agentName,
        personality: this.identity.personality,
        ownerName: this.identity.ownerName,
        ownerDescription: this.identity.ownerDescription,
        language: this.identity.language,
        customRules: this.identity.customRules,
      });
      logger.info('Soul migrated from legacy identity.');
    }

    const soul = this.soulEngine.getSoul();
    if (soul.owner.name) {
      logger.info(`Soul: ${soul.name} | Owner: ${soul.owner.name} | Conversations: ${soul.adaptiveData.conversationCount}`);
    } else {
      logger.info('Soul not configured — bootstrap will trigger on first message.');
    }

    // Load skills + register their tools
    await this.loadAndRegisterSkills();

    // Initialize semantic memory (non-blocking)
    this.memoryManager.initSemantic().catch(err => {
      logger.warn(`Semantic memory init failed (non-critical): ${err}`);
    });

    this.isReady = true;
    logger.info(`AgentController ready. Skills: ${this.skills.length}, Tools: ${this.toolRegistry.listNames().join(', ')}`);
  }

  private async loadAndRegisterSkills(): Promise<void> {
    this.skills = this.skillLoader.loadAll();

    for (const skill of this.skills) {
      // Register tool definitions as callable ScriptTools
      if (skill.tools.length > 0) {
        for (const toolDef of skill.tools) {
          const scriptTool = new ScriptTool(toolDef, skill.dirPath);
          this.toolRegistry.register(scriptTool);
          logger.info(`Registered skill tool: ${toolDef.name} (from ${skill.name})`);
        }
      }

      // Install dependencies if not already installed
      if (skill.dependencies && !this.skillInstaller.isInstalled(skill.dirPath)) {
        const depsCheck = await this.skillExecutor.checkDependencies(skill);
        if (!depsCheck.ok) {
          logger.info(`Installing dependencies for skill: ${skill.name}`);
          const installResult = await this.skillInstaller.install(skill);
          if (!installResult.success) {
            logger.warn(`Skill ${skill.name} dependency install partial: ${installResult.failed.join(', ')}`);
          } else {
            logger.info(`Skill ${skill.name} dependencies installed: ${installResult.installed.join(', ')}`);
          }
        }
      }
    }
  }

  private getSystemPrompt(): string {
    // Use SoulEngine if configured, fallback to legacy identity, then generic
    const soul = this.soulEngine.getSoul();
    if (soul.owner.name) {
      return this.soulEngine.buildSystemPrompt();
    }

    // Legacy fallback
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

    // ── Soul Bootstrap: intercept if first-time setup ──────
    if (this.soulBootstrap.needsBootstrap() || this.soulBootstrap.isInProgress()) {
      const bootstrapResponse = this.soulBootstrap.processMessage(userMessage);
      if (bootstrapResponse !== null) {
        // During bootstrap, we return directly without going through the LLM
        logger.info(`[SoulBootstrap] Phase: ${this.soulBootstrap.getPhase()}`);
        telemetry.track({
          type: 'config_change',
          severity: 'info',
          category: 'soul_bootstrap',
          message: `Bootstrap phase: ${this.soulBootstrap.getPhase()}`,
          data: { user_id: userId, phase: this.soulBootstrap.getPhase() },
        });
        return { answer: bootstrapResponse, isFileOutput: false, isAudioOutput: false };
      }
      // Bootstrap completed — soul is now configured
      logger.info('[SoulBootstrap] Completed! Soul is ready.');
      telemetry.track({
        type: 'config_change',
        severity: 'info',
        category: 'soul_bootstrap',
        message: 'Soul bootstrap completed',
        data: { user_id: userId, soul_name: this.soulEngine.getSoul().name },
      });
    }

    // ── Adaptive learning: teach the soul from every message
    this.soulEngine.learnFromConversation(userMessage);

    // ── Extract memories from message (zero-cost heuristics)
    this.memoryManager.learnFromMessage(userId, userMessage).catch(() => {});

    const provider = ProviderFactory.create();
    const providerName = ProviderFactory.getDefaultName();

    captureLog('info', `Processing [${providerName}] from ${userId}: "${userMessage.substring(0, 80)}"`);

    // Prepare conversation context (short-term)
    const { conversationId, messages } = this.memoryManager.prepareContext(
      userId,
      userMessage,
      providerName
    );

    // Build system prompt from identity
    let systemPrompt = this.getSystemPrompt();

    // ── Semantic memory: inject relevant long-term memories ──
    // Only searches when heuristics detect the message needs context
    try {
      const semanticContext = await this.memoryManager.getSemanticContext(userId, userMessage);
      if (semanticContext) {
        systemPrompt += semanticContext;
      }
    } catch (err) {
      logger.warn(`Semantic context retrieval failed (non-critical): ${err}`);
    }

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

    // ── Multi-Agent Orchestration ──────────────────────────────
    // The orchestrator analyzes the request and decides:
    //   - 'direct': Simple task → use normal AgentLoop
    //   - 'single_delegate'/'multi_delegate': Complex → create sub-agents
    let result: AgentResult;
    const processStart = Date.now();

    try {
      const orchResult = await this.orchestrator.process(
        userMessage,
        systemPrompt,
        messages,
        provider
      );

      if (orchResult.delegated && orchResult.answer) {
        // Orchestrator handled it with sub-agents
        logger.info(`[AgentController] Orchestrator delegated: ${orchResult.metrics.strategy} (${orchResult.metrics.subtaskCount} subtasks, ${orchResult.metrics.totalDurationMs}ms)`);
        result = {
          answer: orchResult.answer,
          isFileOutput: false,
          isAudioOutput: requiresAudioReply,
        };

        // Check for file output pattern in orchestrated answer
        const fileMatch = orchResult.answer.match(/\[FILE:([^\]]+)\]/);
        if (fileMatch) {
          result.answer = orchResult.answer.replace(fileMatch[0], '').trim();
          result.isFileOutput = true;
          result.filePath = fileMatch[1];
        }
      } else {
        // Direct handling — use normal AgentLoop
        result = await this.runAgentLoop(provider, providerName, messages, systemPrompt, requiresAudioReply, userId);
      }
    } catch (err) {
      // Orchestrator failed — fallback to direct AgentLoop
      logger.warn(`Orchestrator failed, falling back to direct: ${err}`);
      result = await this.runAgentLoop(provider, providerName, messages, systemPrompt, requiresAudioReply, userId);
    }

    // Track message processing
    const processDuration = Date.now() - processStart;
    telemetry.trackMessage(userId, userMessage.length, processDuration, providerName);

    // Persist response
    this.memoryManager.saveAssistantReply(conversationId, result.answer);

    return result;
  }

  /**
   * Run the standard AgentLoop (single-agent ReAct loop)
   * Used for direct handling or as fallback when orchestrator fails
   */
  private async runAgentLoop(
    provider: ILlmProvider,
    providerName: string,
    messages: Message[],
    systemPrompt: string,
    requiresAudioReply: boolean,
    userId: string
  ): Promise<AgentResult> {
    try {
      const loop = new AgentLoop(provider, this.toolRegistry, this.hookManager, this.thinkingEngine);
      return await loop.run(messages, systemPrompt, requiresAudioReply);
    } catch (err) {
      logger.warn(`Primary provider failed, trying fallback: ${err}`);
      telemetry.trackError(err instanceof Error ? err : new Error(String(err)), 'primary_provider_failed', {
        provider: providerName,
        user_id: userId,
      });
      return await ProviderFactory.withFallback(async (fallbackProvider) => {
        const loop = new AgentLoop(fallbackProvider, this.toolRegistry, this.hookManager, this.thinkingEngine);
        return loop.run(messages, systemPrompt, requiresAudioReply);
      });
    }
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
    const builtinTools = ['create_file', 'read_file', 'get_datetime', 'create_skill', 'list_skills', 'delete_skill', 'validate_skill', 'shell_exec', 'run_code'];
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
    // Reload soul from disk
    const dataDir = require('path').resolve(process.cwd(), 'data');
    this.soulEngine = new SoulEngine(dataDir);
    this.soulBootstrap = new SoulBootstrap(this.soulEngine);
    const soul = this.soulEngine.getSoul();
    logger.info(`Soul reloaded: ${soul.name} | Owner: ${soul.owner.name || '(not set)'}`);
  }

  getStatus() {
    const providers = ProviderFactory.listProviders();
    const soul = this.soulEngine.getSoul();
    return {
      ready: this.isReady,
      defaultProvider: ProviderFactory.getDefaultName(),
      providers: providers,
      agentName: soul.name || this.identity?.agentName || 'BollaClaw',
      owner: soul.owner.name || this.identity?.ownerName || '(not configured)',
      soulConfigured: !!soul.owner.name,
      conversationCount: soul.adaptiveData.conversationCount,
      soulVersion: soul.version,
      skills: this.skills.map((s) => ({
        name: s.name,
        description: s.description,
        executable: s.isExecutable,
        tools: s.tools.map((t) => t.name),
        runtime: s.runtime,
      })),
      tools: this.toolRegistry.listNames(),
      orchestrator: this.orchestrator.getStatus(),
    };
  }
}
