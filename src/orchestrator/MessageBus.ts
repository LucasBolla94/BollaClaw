import { logger } from '../utils/logger';

// ============================================================
// MessageBus — Inter-agent communication system
// ============================================================
// Enables sub-agents to:
//   1. Share results with the orchestrator
//   2. Share context between each other (when authorized)
//   3. Broadcast events (task started, completed, failed)
//   4. Maintain a shared context object for the current task
// ============================================================

export interface AgentMessage {
  /** Message unique ID */
  id: string;
  /** Sending agent ID */
  from: string;
  /** Target agent ID or 'orchestrator' or 'broadcast' */
  to: string;
  /** Message type */
  type: 'result' | 'context' | 'request' | 'status' | 'error';
  /** Payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
}

export interface TaskContext {
  /** Current task ID */
  taskId: string;
  /** User's original request */
  userRequest: string;
  /** Shared data that any agent can read/write */
  sharedData: Map<string, unknown>;
  /** Results from completed sub-tasks */
  completedResults: Map<string, string>;
  /** Sub-task dependency graph */
  dependencies: Map<string, string[]>;
  /** Execution order */
  executionPlan: string[];
  /** Start time */
  startedAt: number;
}

type MessageHandler = (msg: AgentMessage) => Promise<void>;

export class MessageBus {
  private handlers = new Map<string, MessageHandler[]>();
  private messageLog: AgentMessage[] = [];
  private taskContext: TaskContext | null = null;
  private messageCounter = 0;
  private static readonly MAX_LOG_SIZE = 200;

  /**
   * Create a new task context for the current orchestration
   */
  createTaskContext(taskId: string, userRequest: string): TaskContext {
    this.taskContext = {
      taskId,
      userRequest,
      sharedData: new Map(),
      completedResults: new Map(),
      dependencies: new Map(),
      executionPlan: [],
      startedAt: Date.now(),
    };
    return this.taskContext;
  }

  /**
   * Get the current task context
   */
  getTaskContext(): TaskContext | null {
    return this.taskContext;
  }

  /**
   * Subscribe to messages for a specific agent
   */
  subscribe(agentId: string, handler: MessageHandler): void {
    if (!this.handlers.has(agentId)) {
      this.handlers.set(agentId, []);
    }
    this.handlers.get(agentId)!.push(handler);
  }

  /**
   * Unsubscribe all handlers for an agent
   */
  unsubscribe(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /**
   * Send a message to a specific agent or broadcast
   */
  async send(msg: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMsg: AgentMessage = {
      ...msg,
      id: `msg_${++this.messageCounter}_${Date.now()}`,
      timestamp: Date.now(),
    };

    // Log the message
    this.messageLog.push(fullMsg);
    if (this.messageLog.length > MessageBus.MAX_LOG_SIZE) {
      this.messageLog = this.messageLog.slice(-MessageBus.MAX_LOG_SIZE);
    }

    logger.debug(`[MessageBus] ${fullMsg.from} → ${fullMsg.to}: ${fullMsg.type}`);

    if (fullMsg.to === 'broadcast') {
      // Broadcast to all subscribers
      for (const [agentId, handlers] of this.handlers) {
        if (agentId !== fullMsg.from) {
          for (const handler of handlers) {
            try {
              await handler(fullMsg);
            } catch (err) {
              logger.warn(`[MessageBus] Handler error for ${agentId}: ${err}`);
            }
          }
        }
      }
    } else {
      // Direct message
      const handlers = this.handlers.get(fullMsg.to) || [];
      for (const handler of handlers) {
        try {
          await handler(fullMsg);
        } catch (err) {
          logger.warn(`[MessageBus] Handler error for ${fullMsg.to}: ${err}`);
        }
      }
    }
  }

  /**
   * Store a result from a completed sub-agent
   */
  storeResult(agentId: string, result: string): void {
    if (this.taskContext) {
      this.taskContext.completedResults.set(agentId, result);
    }
  }

  /**
   * Get result from a specific agent
   */
  getResult(agentId: string): string | undefined {
    return this.taskContext?.completedResults.get(agentId);
  }

  /**
   * Get all completed results
   */
  getAllResults(): Map<string, string> {
    return this.taskContext?.completedResults ?? new Map();
  }

  /**
   * Store shared data accessible by all agents
   */
  setSharedData(key: string, value: unknown): void {
    if (this.taskContext) {
      this.taskContext.sharedData.set(key, value);
    }
  }

  /**
   * Get shared data
   */
  getSharedData(key: string): unknown {
    return this.taskContext?.sharedData.get(key);
  }

  /**
   * Get the full message log (for debugging)
   */
  getMessageLog(): AgentMessage[] {
    return [...this.messageLog];
  }

  /**
   * Clear everything for a new task
   */
  reset(): void {
    this.taskContext = null;
    this.messageLog = [];
    this.handlers.clear();
    this.messageCounter = 0;
  }

  /**
   * Get execution summary for telemetry
   */
  getSummary(): Record<string, unknown> {
    return {
      taskId: this.taskContext?.taskId,
      totalMessages: this.messageLog.length,
      completedAgents: this.taskContext?.completedResults.size ?? 0,
      durationMs: this.taskContext ? Date.now() - this.taskContext.startedAt : 0,
    };
  }
}
