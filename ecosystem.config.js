module.exports = {
  apps: [
    {
      name: 'bollaclaw',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // Restart strategy: wait 5s on crash, max 15 restarts before stopping
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: '10s',
      // Exponential backoff on consecutive crashes
      exp_backoff_restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      // Rotate logs at 10MB
      log_file: './logs/pm2-combined.log',
    },
  ],
};
