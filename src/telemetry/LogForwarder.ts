import { Writable } from 'stream';

// ============================================================
// LogForwarder — Captures stdout/stderr and sends to BollaWatch
// ============================================================
// Intercepts console.log/error/warn output, batches the lines,
// and periodically sends them to BollaWatch's /api/v1/logs endpoint.
//
// Why: When the bot crashes or PM2 restarts it, stdout/stderr
// logs are lost. This forwards them to BollaWatch where the
// dev team can see everything even after a crash.
// ============================================================

const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 10_000;        // 10s
const REQUEST_TIMEOUT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000; // 1min — verify connection alive
const MAX_CONSECUTIVE_FAILURES = 30;     // After 30 failures (~5min), reduce flush rate

interface LogEntry {
  source: 'stdout' | 'stderr';
  message: string;
  timestamp: string;
}

class LogForwarderClass {
  private hubUrl: string;
  private instanceId: string;
  private token: string;
  private batch: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private connected = false;
  private consecutiveFailures = 0;
  private totalSent = 0;
  private totalDropped = 0;
  private originalStdoutWrite: typeof process.stdout.write;
  private originalStderrWrite: typeof process.stderr.write;

  constructor() {
    this.hubUrl = process.env.BOLLAWATCH_URL || 'http://watch.bolla.network';
    this.token = process.env.BOLLAWATCH_SECRET || 'bollaclaw';
    this.instanceId = ''; // Will be set from TelemetryReporter
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
  }

  /**
   * Start intercepting stdout/stderr
   * Call AFTER TelemetryReporter.start() to get the instanceId
   */
  start(instanceId: string): void {
    if (this.enabled) return;
    if (this.hubUrl === 'disabled') return;

    this.instanceId = instanceId;
    this.enabled = true;

    // Intercept stdout
    const self = this;
    process.stdout.write = function (chunk: string | Uint8Array, ...args: unknown[]): boolean {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      self.capture('stdout', str);
      return self.originalStdoutWrite.call(process.stdout, chunk, ...(args as [any, any]));
    } as typeof process.stdout.write;

    // Intercept stderr
    process.stderr.write = function (chunk: string | Uint8Array, ...args: unknown[]): boolean {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      self.capture('stderr', str);
      return self.originalStderrWrite.call(process.stderr, chunk, ...(args as [any, any]));
    } as typeof process.stderr.write;

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Start periodic health check — ensures persistent connection
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_CHECK_INTERVAL_MS);

    // Initial health check
    this.healthCheck();
  }

  /** Persistent connection health check */
  private async healthCheck(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${this.hubUrl}/health`, { signal: controller.signal });
        if (res.ok) {
          if (!this.connected) {
            this.connected = true;
            this.consecutiveFailures = 0;
          }
        } else {
          this.connected = false;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      this.connected = false;
    }
  }

  /** Check if the gateway connection is alive */
  isConnected(): boolean {
    return this.enabled && this.connected;
  }

  /** Stats for debugging */
  getStats(): { connected: boolean; queueSize: number; totalSent: number; totalDropped: number; failures: number } {
    return {
      connected: this.connected,
      queueSize: this.batch.length,
      totalSent: this.totalSent,
      totalDropped: this.totalDropped,
      failures: this.consecutiveFailures,
    };
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // Restore original writers
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Final flush
    this.flush();
  }

  private capture(source: 'stdout' | 'stderr', raw: string): void {
    if (!this.enabled) return;

    // Split into lines and process each
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      this.batch.push({
        source,
        message: trimmed.substring(0, 5000),
        timestamp: new Date().toISOString(),
      });
    }

    // Auto-flush if batch is full
    if (this.batch.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0 || !this.instanceId) return;

    // If too many failures, slow down and drop old logs to prevent memory buildup
    if (this.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      // Keep only the last BATCH_SIZE entries
      if (this.batch.length > BATCH_SIZE) {
        this.totalDropped += this.batch.length - BATCH_SIZE;
        this.batch = this.batch.slice(-BATCH_SIZE);
      }
    }

    const logs = [...this.batch];
    this.batch = [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${this.hubUrl}/api/v1/logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BollaWatch-Token': this.token,
          },
          body: JSON.stringify({
            instance_id: this.instanceId,
            logs,
          }),
          signal: controller.signal,
        });

        if (response.ok) {
          this.connected = true;
          this.consecutiveFailures = 0;
          this.totalSent += logs.length;
        } else {
          this.consecutiveFailures++;
          this.connected = false;
          // Put back if failed (capped)
          if (this.batch.length + logs.length <= BATCH_SIZE * 3) {
            this.batch = [...logs, ...this.batch];
          } else {
            this.totalDropped += logs.length;
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      this.consecutiveFailures++;
      this.connected = false;
      // Put back if failed (capped)
      if (this.batch.length + logs.length <= BATCH_SIZE * 3) {
        this.batch = [...logs, ...this.batch];
      } else {
        this.totalDropped += logs.length;
      }
    }
  }
}

// Singleton
export const logForwarder = new LogForwarderClass();
