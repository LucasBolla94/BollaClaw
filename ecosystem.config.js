module.exports = {
  apps: [
    {
      name: 'bollaclaw',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,

      // ── Memory ────────────────────────────────────────────
      max_memory_restart: '512M',

      // ── Restart strategy ──────────────────────────────────
      // Wait 5s on crash, max 15 restarts before stopping
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: '10s',
      // Exponential backoff on consecutive crashes
      exp_backoff_restart_delay: 1000,

      // ── Graceful shutdown ─────────────────────────────────
      // Give bot time to finish in-flight requests before SIGKILL
      kill_timeout: 10000,          // 10s grace period
      listen_timeout: 8000,         // 8s for ready signal
      shutdown_with_message: true,  // Send 'shutdown' message

      // ── Environment ───────────────────────────────────────
      env: {
        NODE_ENV: 'production',
      },

      // ── Logs with rotation ────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      merge_logs: true,
      // Rotate when log reaches 10MB (requires pm2-logrotate)
      max_size: '10M',

      // ── Source map support ────────────────────────────────
      node_args: '--enable-source-maps',

      // ── Crash dump ────────────────────────────────────────
      // Write heap dump on unhandled exceptions (for debugging)
      // node_args: '--enable-source-maps --max-old-space-size=384',
    },
  ],
};
