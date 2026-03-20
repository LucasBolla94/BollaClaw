import { ILlmProvider, Message } from '../providers/ILlmProvider';
import { ProviderFactory } from '../providers/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SubAgent, SubAgentConfig, SubAgentResult, SubAgentType } from './SubAgent';
import { MessageBus } from './MessageBus';
import { logger } from '../utils/logger';
import { telemetry } from '../telemetry/TelemetryReporter';

// ============================================================
// AgentOrchestrator — Master orchestrator for multi-agent system
// ============================================================
// Responsibilities:
//   1. Analyze user request complexity
//   2. Decide: handle directly vs delegate to sub-agents
//   3. Decompose complex tasks into sub-tasks (via LLM)
//   4. Create specialist sub-agents for each sub-task
//   5. Execute sub-tasks (parallel when possible, sequential when dependent)
//   6. Collect and synthesize results from all sub-agents
//   7. Manage sub-agent lifecycle (create → execute → cleanup)
// ============================================================

export interface TaskDecomposition {
  /** Whether the task should be delegated or handled directly */
  strategy: 'direct' | 'single_delegate' | 'multi_delegate';
  /** Sub-tasks to execute */
  subtasks: SubTaskSpec[];
  /** Reasoning for the decomposition */
  reasoning: string;
}

export interface SubTaskSpec {
  /** Unique sub-task ID */
  id: string;
  /** What this sub-task should accomplish */
  task: string;
  /** Specialist role needed */
  role: string;
  /** System prompt for the specialist */
  systemPrompt: string;
  /** Which provider to use (default: router for simple, default for complex) */
  providerName?: string;
  /** Tools needed for this sub-task */
  tools: string[];
  /** Dependencies on other sub-task IDs (must complete first) */
  dependsOn: string[];
  /** Priority (higher = execute first among peers) */
  priority: number;
  /** Max iterations for this sub-task */
  maxIterations?: number;
}

export interface OrchestratorResult {
  /** Final synthesized answer */
  answer: string;
  /** Whether the orchestrator delegated to sub-agents */
  delegated: boolean;
  /** Results from individual sub-agents */
  subResults: SubAgentResult[];
  /** Execution metrics */
  metrics: {
    totalDurationMs: number;
    subtaskCount: number;
    parallelBatches: number;
    totalIterations: number;
    strategy: string;
  };
}

export class AgentOrchestrator {
  private toolRegistry: ToolRegistry;
  private messageBus: MessageBus;
  private fixedAgents = new Map<string, SubAgent>();
  private activeAgents = new Map<string, SubAgent>();
  private taskCounter = 0;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
    this.messageBus = new MessageBus();
  }

  /**
   * Register a fixed (persistent) sub-agent
   */
  registerFixedAgent(config: SubAgentConfig): void {
    const agent = new SubAgent({ ...config, type: 'fixed' }, this.toolRegistry);
    this.fixedAgents.set(config.id, agent);
    logger.info(`[Orchestrator] Registered fixed agent: ${config.name} (${config.id})`);
  }

  /**
   * Main entry: process a user request through the orchestration system
   */
  async process(
    userMessage: string,
    systemPrompt: string,
    conversationHistory: Message[],
    primaryProvider: ILlmProvider
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const taskId = `task_${++this.taskCounter}_${Date.now()}`;

    logger.info(`[Orchestrator] Processing task ${taskId}: "${userMessage.substring(0, 80)}..."`);

    // Step 1: Analyze task complexity and decide strategy
    const decomposition = await this.decomposeTask(userMessage, systemPrompt, primaryProvider);

    logger.info(`[Orchestrator] Strategy: ${decomposition.strategy} (${decomposition.subtasks.length} subtasks) — ${decomposition.reasoning}`);

    telemetry.track({
      type: 'agent_event',
      severity: 'info',
      category: 'orchestrator_decompose',
      message: `Task decomposed: ${decomposition.strategy}`,
      data: {
        task_id: taskId,
        strategy: decomposition.strategy,
        subtask_count: decomposition.subtasks.length,
        reasoning: decomposition.reasoning,
      },
    });

    // Step 2: Handle based on strategy
    if (decomposition.strategy === 'direct') {
      // Simple task — no delegation needed
      return {
        answer: '', // AgentController will handle via normal AgentLoop
        delegated: false,
        subResults: [],
        metrics: {
          totalDurationMs: Date.now() - startTime,
          subtaskCount: 0,
          parallelBatches: 0,
          totalIterations: 0,
          strategy: 'direct',
        },
      };
    }

    // Step 3: Create task context
    this.messageBus.createTaskContext(taskId, userMessage);

    // Step 4: Execute sub-tasks
    const subResults = await this.executeSubtasks(
      decomposition.subtasks,
      systemPrompt,
      conversationHistory
    );

    // Step 5: Synthesize results
    const answer = await this.synthesizeResults(
      userMessage,
      systemPrompt,
      subResults,
      primaryProvider
    );

    // Step 6: Cleanup temporary agents
    this.cleanupTemporaryAgents();

    const totalDuration = Date.now() - startTime;
    const totalIterations = subResults.reduce((sum, r) => sum + r.metrics.iterations, 0);

    logger.info(`[Orchestrator] Task ${taskId} completed in ${totalDuration}ms (${subResults.length} agents, ${totalIterations} total iterations)`);

    telemetry.track({
      type: 'agent_event',
      severity: 'info',
      category: 'orchestrator_complete',
      message: `Task completed: ${decomposition.strategy}`,
      data: {
        task_id: taskId,
        duration_ms: totalDuration,
        agents_used: subResults.length,
        total_iterations: totalIterations,
        all_success: subResults.every(r => r.success),
      },
    });

    return {
      answer,
      delegated: true,
      subResults,
      metrics: {
        totalDurationMs: totalDuration,
        subtaskCount: subResults.length,
        parallelBatches: this.countParallelBatches(decomposition.subtasks),
        totalIterations,
        strategy: decomposition.strategy,
      },
    };
  }

  /**
   * Step 1: Analyze and decompose the user's request
   * Uses the LLM to decide whether to delegate and how to split the task
   */
  private async decomposeTask(
    userMessage: string,
    systemPrompt: string,
    provider: ILlmProvider
  ): Promise<TaskDecomposition> {
    // Get available tools and fixed agents for context
    const availableTools = this.toolRegistry.listNames();
    const fixedAgentInfo = Array.from(this.fixedAgents.values())
      .map(a => `- ${a.name}: ${a.role}`)
      .join('\n');

    const decompositionPrompt = `Você é o Orquestrador do BollaClaw — um sistema multi-agent inteligente.

Analise a mensagem do usuário e decida a melhor estratégia de execução.

## Ferramentas disponíveis
${availableTools.join(', ')}

${fixedAgentInfo ? `## Agentes fixos disponíveis\n${fixedAgentInfo}\n` : ''}
## Regras de decisão

**Use "direct"** quando:
- A tarefa é simples (pergunta, conversa casual, 1 step)
- Não precisa de mais de 1 ferramenta
- Pode ser resolvida em 1-2 iterações do agente principal

**Use "single_delegate"** quando:
- A tarefa requer expertise específica (análise de código, pesquisa profunda, etc)
- Pode ser resolvida por 1 especialista focado
- Precisa de isolamento de contexto

**Use "multi_delegate"** quando:
- A tarefa tem múltiplas partes independentes ou semi-independentes
- Diferentes partes precisam de especialidades diferentes
- Pode se beneficiar de execução paralela
- É uma tarefa complexa que se beneficia de divisão

## Formato de resposta

Responda APENAS com JSON válido, sem markdown:
{
  "strategy": "direct" | "single_delegate" | "multi_delegate",
  "reasoning": "Explicação breve da decisão",
  "subtasks": [
    {
      "id": "subtask_1",
      "task": "Descrição clara do que fazer",
      "role": "Nome do especialista (ex: Analista de Dados, Engenheiro Python, Pesquisador)",
      "systemPrompt": "Instruções detalhadas para o especialista",
      "providerName": null,
      "tools": ["tool1", "tool2"],
      "dependsOn": [],
      "priority": 1,
      "maxIterations": 3
    }
  ]
}

Se "strategy" é "direct", retorne "subtasks" como array vazio [].

## Mensagem do usuário
${userMessage}`;

    try {
      const messages: Message[] = [
        { role: 'system', content: 'Você é um sistema de decomposição de tarefas. Responda APENAS com JSON válido.' },
        { role: 'user', content: decompositionPrompt },
      ];

      // Use router provider (cheap/fast) for decomposition
      let routerProvider: ILlmProvider;
      try {
        routerProvider = ProviderFactory.createRouter();
      } catch {
        routerProvider = provider;
      }

      const response = await routerProvider.complete(messages);
      const content = response.content ?? '';

      // Parse JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('[Orchestrator] Failed to parse decomposition — falling back to direct');
        return { strategy: 'direct', subtasks: [], reasoning: 'Failed to parse decomposition' };
      }

      const parsed = JSON.parse(jsonMatch[0]) as TaskDecomposition;

      // Validate
      if (!parsed.strategy || !['direct', 'single_delegate', 'multi_delegate'].includes(parsed.strategy)) {
        return { strategy: 'direct', subtasks: [], reasoning: 'Invalid strategy' };
      }

      // Ensure subtasks have valid structure
      if (parsed.subtasks) {
        parsed.subtasks = parsed.subtasks.filter(st =>
          st.id && st.task && st.role && st.systemPrompt
        );

        // Validate tool references
        for (const st of parsed.subtasks) {
          st.tools = (st.tools || []).filter(t => availableTools.includes(t));
          st.dependsOn = st.dependsOn || [];
          st.priority = st.priority ?? 1;
          st.maxIterations = st.maxIterations ?? 3;
        }
      }

      return parsed;

    } catch (err) {
      logger.warn(`[Orchestrator] Decomposition failed: ${err} — falling back to direct`);
      return { strategy: 'direct', subtasks: [], reasoning: `Decomposition error: ${err}` };
    }
  }

  /**
   * Step 4: Execute sub-tasks respecting dependencies (DAG execution)
   */
  private async executeSubtasks(
    subtasks: SubTaskSpec[],
    systemPrompt: string,
    conversationHistory: Message[]
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    const completed = new Set<string>();
    const subtaskMap = new Map(subtasks.map(st => [st.id, st]));

    // Build conversation context summary (limited)
    const contextSummary = this.buildContextSummary(conversationHistory);

    while (completed.size < subtasks.length) {
      // Find tasks ready to execute (all dependencies completed)
      const readyTasks = subtasks.filter(st =>
        !completed.has(st.id) &&
        st.dependsOn.every(dep => completed.has(dep))
      );

      if (readyTasks.length === 0) {
        // No tasks ready but not all completed — circular dependency or all remaining failed
        logger.warn('[Orchestrator] No ready tasks — possible circular dependency');
        break;
      }

      // Sort by priority (higher first)
      readyTasks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

      // Execute ready tasks in parallel
      logger.info(`[Orchestrator] Executing batch of ${readyTasks.length} tasks in parallel: [${readyTasks.map(t => t.id).join(', ')}]`);

      const batchResults = await Promise.allSettled(
        readyTasks.map(async (subtask) => {
          // Build context from dependencies
          const depContext = this.buildDependencyContext(subtask, results);

          // Create or get agent
          const agent = this.getOrCreateAgent(subtask);
          this.activeAgents.set(subtask.id, agent);

          // Execute
          const fullContext = [contextSummary, depContext].filter(Boolean).join('\n\n');
          const result = await agent.execute(subtask.task, fullContext || undefined);

          // Store result in message bus
          if (result.success) {
            this.messageBus.storeResult(subtask.id, result.output);
          }

          return result;
        })
      );

      // Process results
      for (let i = 0; i < readyTasks.length; i++) {
        const subtask = readyTasks[i];
        const settled = batchResults[i];

        if (settled.status === 'fulfilled') {
          results.push(settled.value);
          completed.add(subtask.id);

          if (!settled.value.success) {
            logger.warn(`[Orchestrator] Subtask ${subtask.id} completed with error: ${settled.value.error}`);
            // Still mark as completed to unblock dependents, they'll see the error
          }
        } else {
          // Promise rejected (shouldn't happen normally since SubAgent catches errors)
          logger.error(`[Orchestrator] Subtask ${subtask.id} rejected: ${settled.reason}`);
          completed.add(subtask.id);
          results.push({
            agentId: subtask.id,
            agentName: subtask.role,
            output: '',
            success: false,
            error: String(settled.reason),
            toolCallsLog: [],
            metrics: { iterations: 0, totalDurationMs: 0, providerName: 'unknown', tokenEstimate: 0 },
          });
        }
      }
    }

    return results;
  }

  /**
   * Step 5: Synthesize all sub-agent results into a final answer
   */
  private async synthesizeResults(
    userMessage: string,
    systemPrompt: string,
    subResults: SubAgentResult[],
    provider: ILlmProvider
  ): Promise<string> {
    if (subResults.length === 0) return '';
    if (subResults.length === 1 && subResults[0].success) {
      return subResults[0].output;
    }

    // Build synthesis prompt
    const resultsSummary = subResults.map((r, i) => {
      const status = r.success ? '✅' : '❌';
      return `### ${status} ${r.agentName} (${r.agentId})\n${r.success ? r.output : `Erro: ${r.error}`}`;
    }).join('\n\n');

    const synthesisPrompt = `Você é o sintetizador final do BollaClaw multi-agent system.

Vários agentes especialistas trabalharam na tarefa do usuário. Sintetize os resultados em uma resposta única, coesa e completa.

## Pedido original do usuário
${userMessage}

## Resultados dos agentes
${resultsSummary}

## Instruções
- Combine os resultados em uma resposta fluida e natural
- Se algum agente falhou, mencione que houve um problema parcial
- NÃO mencione que foram usados "sub-agentes" ou "agentes especialistas" — o usuário não precisa saber da arquitetura interna
- Responda como se VOCÊ tivesse feito tudo
- Mantenha o tom e idioma do sistema (provavelmente português)`;

    try {
      const messages: Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: synthesisPrompt },
      ];

      const response = await provider.complete(messages);
      return response.content ?? subResults.map(r => r.output).filter(Boolean).join('\n\n');
    } catch (err) {
      logger.warn(`[Orchestrator] Synthesis failed: ${err} — returning raw results`);
      return subResults.map(r => r.output).filter(Boolean).join('\n\n');
    }
  }

  /**
   * Get existing fixed agent or create temporary agent for a subtask
   */
  private getOrCreateAgent(subtask: SubTaskSpec): SubAgent {
    // Check if there's a matching fixed agent
    for (const [id, agent] of this.fixedAgents) {
      if (agent.role.toLowerCase().includes(subtask.role.toLowerCase()) ||
          subtask.role.toLowerCase().includes(agent.role.toLowerCase())) {
        logger.info(`[Orchestrator] Using fixed agent "${agent.name}" for subtask ${subtask.id}`);
        return agent;
      }
    }

    // Create temporary agent
    const config: SubAgentConfig = {
      id: subtask.id,
      name: `${subtask.role.replace(/\s+/g, '')}`,
      role: subtask.role,
      systemPrompt: subtask.systemPrompt,
      providerName: subtask.providerName || undefined,
      maxIterations: subtask.maxIterations ?? 3,
      timeout: 90_000, // 90s for sub-tasks
      allowedTools: subtask.tools,
      type: 'temporary',
    };

    const agent = new SubAgent(config, this.toolRegistry);
    logger.info(`[Orchestrator] Created temporary agent: ${config.name} for subtask ${subtask.id}`);
    return agent;
  }

  /**
   * Build a minimal context summary from conversation history
   */
  private buildContextSummary(history: Message[]): string {
    // Only include the last few user/assistant messages for context
    const relevant = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-4)
      .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.substring(0, 200)}`)
      .join('\n');

    return relevant ? `## Histórico recente\n${relevant}` : '';
  }

  /**
   * Build context from completed dependency results
   */
  private buildDependencyContext(subtask: SubTaskSpec, results: SubAgentResult[]): string {
    if (!subtask.dependsOn || subtask.dependsOn.length === 0) return '';

    const depResults = results
      .filter(r => subtask.dependsOn.includes(r.agentId) && r.success)
      .map(r => `## Resultado de ${r.agentName}:\n${r.output.substring(0, 2000)}`);

    return depResults.length > 0
      ? `## Contexto de tarefas anteriores\n${depResults.join('\n\n')}`
      : '';
  }

  /**
   * Count how many parallel execution batches are needed
   */
  private countParallelBatches(subtasks: SubTaskSpec[]): number {
    const completed = new Set<string>();
    let batches = 0;

    while (completed.size < subtasks.length) {
      const ready = subtasks.filter(st =>
        !completed.has(st.id) &&
        st.dependsOn.every(dep => completed.has(dep))
      );

      if (ready.length === 0) break;
      ready.forEach(st => completed.add(st.id));
      batches++;
    }

    return batches;
  }

  /**
   * Cleanup temporary agents after task completion
   */
  private cleanupTemporaryAgents(): void {
    const cleaned: string[] = [];
    for (const [id, agent] of this.activeAgents) {
      if (agent.type === 'temporary') {
        this.activeAgents.delete(id);
        this.messageBus.unsubscribe(id);
        cleaned.push(agent.name);
      }
    }
    if (cleaned.length > 0) {
      logger.info(`[Orchestrator] Cleaned up ${cleaned.length} temporary agents: [${cleaned.join(', ')}]`);
    }
  }

  /**
   * Get status of all agents (for admin/monitoring)
   */
  getStatus() {
    return {
      fixedAgents: Array.from(this.fixedAgents.values()).map(a => a.getInfo()),
      activeAgents: Array.from(this.activeAgents.values()).map(a => a.getInfo()),
      taskCount: this.taskCounter,
      messageBusSummary: this.messageBus.getSummary(),
    };
  }

  /**
   * Get message bus reference (for external integrations)
   */
  getMessageBus(): MessageBus {
    return this.messageBus;
  }
}
