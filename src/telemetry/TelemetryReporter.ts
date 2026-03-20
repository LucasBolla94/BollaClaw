import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

// ============================================================
// TelemetryReporter — Sends events to BollaWatch hub
// ============================================================
// Batches events in memory and flushes periodically or when
// the batch is full. Non-blocking — never throws to caller.
// Features: retry with backoff, version tracking, rich metadata.
// ============================================================

export type EventType =
  | 'error'           // Crashes, exceptions, API failures
  | 'message'         // User message processed
  | 'tool_call'       // Tool execution
  | 'agent_loop'      // AgentLoop iteration details
  | 'agent_event'     // Sub-agent and orchestrator events
  | 'provider_call'   // LLM API call
  | 'startup'         // Bot started
  | 'shutdown'        // Bot stopping
  | 'metric'          // Periodic metric snapshot
  | 'config_change';  // Config/skill reload

export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface TelemetryEvent {
  type: EventType;
  severity: Severity;
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  stack_trace?: string;
  duration_ms?: number;
  timestamp?: string;
}

interface MetricsSnapshot {
  cpu_percent: number;
  memory_mb: number;
  memory_percent: number;
  uptime_seconds: number;
  messages_processed: number;
  tool_calls_total: number;
  errors_total: number;
  avg_response_ms: number;
  active_conversations: number;
}

// ── Configuration ──────────────────────────────────────────

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 15_000;     // 15s
const METRICS_INTERVAL_MS = 60_000;   // 1min
const REQUEST_TIMEOUT_MS = 5_000;     // 5s
const MAX_RETRY_BATCH = BATCH_SIZE * 3; // Max events in retry buffer
const REGISTER_RETRY_INTERVAL = 30_000; // 30s retry registration

class TelemetryReporterClass {
  private instanceId: string;
  private hubUrl: string;
  private enabled: boolean;
  private batch: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private registerTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;
  private consecutiveFailures = 0;
  private lastFlushSuccess = true;
  private version: string;

  // Counters for metrics
  private counters = {
    messagesProcessed: 0,
    toolCallsTotal: 0,
    errorsTotal: 0,
    responseTimes: [] as number[],
    activeConversations: new Set<string>(),
  };

  constructor() {
    this.instanceId = this.getOrCreateInstanceId();
    this.hubUrl = process.env.BOLLAWATCH_URL || 'http://server2.bolla.network:21087';
    this.enabled = this.hubUrl !== 'disabled';
    this.version = this.getVersion();
  }

  // ── Initialization ─────────────────────────────────────

  start(): void {
    if (!this.enabled) {
      logger.info('[Telemetry] Disabled (BOLLAWATCH_URL=disabled)');
      return;
    }

    logger.info(`[Telemetry] Reporting to ${this.hubUrl} (instance: ${this.instanceId})`);

    // Register this instance (with retry)
    this.register();
    this.registerTimer = setInterval(() => {
      if (!this.registered) this.register();
    }, REGISTER_RETRY_INTERVAL);

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Start periodic metrics
    this.metricsTimer = setInterval(() => this.sendMetrics(), METRICS_INTERVAL_MS);

    // Report startup event
    this.track({
      type: 'startup',
      severity: 'info',
      message: 'BollaClaw started',
      data: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        node_version: process.version,
        npm_version: process.env.npm_package_version || 'unknown',
        bollaclaw_version: this.version,
        total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
        cpu_cores: os.cpus().length,
        cpu_model: os.cpus()[0]?.model || 'unknown',
      },
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.registerTimer) clearInterval(this.registerTimer);
    this.flushTimer = null;
    this.metricsTimer = null;
    this.registerTimer = null;
    this.flush(); // Final flush
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isConnected(): boolean {
    return this.enabled && this.registered && this.lastFlushSuccess;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  // ── Event Tracking ─────────────────────────────────────

  track(event: TelemetryEvent): void {
    if (!this.enabled) return;

    event.timestamp = event.timestamp || new Date().toISOString();
    this.batch.push(event);

    // Update counters
    if (event.type === 'message') this.counters.messagesProcessed++;
    if (event.type === 'tool_call') this.counters.toolCallsTotal++;
    if (event.severity === 'error' || event.severity === 'fatal') this.counters.errorsTotal++;
    if (event.duration_ms) this.counters.responseTimes.push(event.duration_ms);

    // Auto-flush if batch is full
    if (this.batch.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  // ── Convenience methods ────────────────────────────────

  trackError(error: Error | string, category?: string, data?: Record<string, unknown>): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.track({
      type: 'error',
      severity: 'error',
      category: category || 'uncaught',
      message: err.message,
      stack_trace: err.stack?.substring(0, 5000),
      data: {
        ...data,
        error_name: err.name,
        bollaclaw_version: this.version,
      },
    });
  }

  trackMessage(userId: string, messageLength: number, durationMs: number, provider: string): void {
    this.counters.activeConversations.add(userId);
    this.track({
      type: 'message',
      severity: 'info',
      category: 'user_message',
      message: `Message processed (${messageLength} chars, ${durationMs}ms)`,
      duration_ms: durationMs,
      data: {
        user_id: userId,
        message_length: messageLength,
        provider,
        active_conversations: this.counters.activeConversations.size,
      },
    });
  }

  trackToolCall(toolName: string, durationMs: number, success: boolean, data?: Record<string, unknown>): void {
    this.track({
      type: 'tool_call',
      severity: success ? 'info' : 'warn',
      category: toolName,
      message: `Tool ${toolName}: ${success ? 'success' : 'failed'} (${durationMs}ms)`,
      duration_ms: durationMs,
      data: { tool: toolName, success, ...data },
    });
  }

  trackAgentLoop(iteration: number, maxIterations: number, durationMs: number, toolCalls: number, reachedEnd: boolean): void {
    this.track({
      type: 'agent_loop',
      severity: reachedEnd ? 'info' : 'warn',
      category: 'agent_loop',
      message: `AgentLoop: ${iteration}/${maxIterations} iterations, ${toolCalls} tool calls (${durationMs}ms)`,
      duration_ms: durationMs,
      data: {
        iteration,
        max_iterations: maxIterations,
        tool_calls: toolCalls,
        reached_end: reachedEnd,
        avg_ms_per_iteration: iteration > 0 ? Math.round(durationMs / iteration) : 0,
      },
    });
  }

  trackProviderCall(provider: string, model: string, durationMs: number, success: boolean, tokenEstimate?: number): void {
    this.track({
      type: 'provider_call',
      severity: success ? 'debug' : 'error',
      category: provider,
      message: `${provider}/${model}: ${success ? 'ok' : 'failed'} (${durationMs}ms)`,
      duration_ms: durationMs,
      data: {
        provider,
        model,
        success,
        token_estimate: tokenEstimate,
        bollaclaw_version: this.version,
      },
    });
  }

  // ── Flush batch to BollaWatch ──────────────────────────

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const events = [...this.batch];
    this.batch = [];

    try {
      await this.post('/api/v1/events', {
        instance_id: this.instanceId,
        events,
      });
      this.consecutiveFailures = 0;
      this.lastFlushSuccess = true;
    } catch {
      this.consecutiveFailures++;
      this.lastFlushSuccess = false;

      // Put events back (capped to prevent memory leak)
      if (this.batch.length + events.length <= MAX_RETRY_BATCH) {
        this.batch = [...events, ...this.batch];
      }

      // Log only first failure and then every 10th to avoid spam
      if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) {
        logger.warn(`[Telemetry] Flush failed (${this.consecutiveFailures} consecutive failures)`);
      }
    }
  }

  // ── Register instance ──────────────────────────────────

  private async register(): Promise<void> {
    if (this.registered) return;

    try {
      let providerName = '';
      let modelName = '';
      try {
        providerName = config.llm.provider;
        modelName = (config.llm as Record<string, string>).model || '';
      } catch { /* config not ready yet */ }

      await this.post('/api/v1/register', {
        instance_id: this.instanceId,
        name: 'BollaClaw',
        hostname: os.hostname(),
        version: this.version,
        provider: providerName,
        model: modelName,
        server_url: os.hostname(),
        meta: {
          platform: os.platform(),
          arch: os.arch(),
          cpus: os.cpus().length,
          cpu_model: os.cpus()[0]?.model || 'unknown',
          total_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
          node_version: process.version,
          bollaclaw_version: this.version,
        },
      });

      this.registered = true;
      logger.info('[Telemetry] Registered with BollaWatch hub');
    } catch {
      // Will retry via interval
    }
  }

  // ── Metrics ────────────────────────────────────────────

  private async sendMetrics(): Promise<void> {
    if (!this.registered) return; // Don't send metrics until registered

    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // CPU usage from load average
    const loadAvg = os.loadavg()[0];
    const cpuPercent = Math.min(100, (loadAvg / cpus.length) * 100);

    const avgResponseMs = this.counters.responseTimes.length > 0
      ? this.counters.responseTimes.reduce((a, b) => a + b, 0) / this.counters.responseTimes.length
      : 0;

    const metrics: MetricsSnapshot & { instance_id: string } = {
      instance_id: this.instanceId,
      cpu_percent: Math.round(cpuPercent * 10) / 10,
      memory_mb: Math.round(usedMem / 1024 / 1024),
      memory_percent: Math.round((usedMem / totalMem) * 1000) / 10,
      uptime_seconds: Math.round(process.uptime()),
      messages_processed: this.counters.messagesProcessed,
      tool_calls_total: this.counters.toolCallsTotal,
      errors_total: this.counters.errorsTotal,
      avg_response_ms: Math.round(avgResponseMs),
      active_conversations: this.counters.activeConversations.size,
    };

    // Reset per-interval counters
    this.counters.responseTimes = [];

    try {
      await this.post('/api/v1/metrics', metrics);
    } catch {
      // Silent fail for metrics
    }
  }

  // ── Shutdown ───────────────────────────────────────────

  private async shutdown(): Promise<void> {
    this.track({
      type: 'shutdown',
      severity: 'info',
      message: 'BollaClaw shutting down',
      data: {
        uptime_seconds: Math.round(process.uptime()),
        messages_processed: this.counters.messagesProcessed,
        tool_calls_total: this.counters.toolCallsTotal,
        errors_total: this.counters.errorsTotal,
        bollaclaw_version: this.version,
      },
    });
    await this.flush();
    this.stop();
  }

  // ── HTTP helper ────────────────────────────────────────

  private async post(urlPath: string, body: unknown): Promise<void> {
    const url = `${this.hubUrl}${urlPath}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Instance ID (stable across restarts) ───────────────

  private getOrCreateInstanceId(): string {
    const hostname = os.hostname();
    const hash = crypto.createHash('sha256')
      .update(hostname + '__bollaclaw__' + (process.env.TELEGRAM_BOT_TOKEN || ''))
      .digest('hex')
      .substring(0, 12);
    return `bc-${hostname}-${hash}`;
  }

  // ── Version tracking ───────────────────────────────────

  private getVersion(): string {
    try {
      // Try to read version from package.json
      const pkgPath = path.resolve(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '0.0.0';
      }
    } catch { /* fallback */ }
    return '0.0.0';
  }
}

// Singleton
export const telemetry = new TelemetryReporterClass();
