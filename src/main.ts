import 'dotenv/config';
import * as fs from 'fs';
import { TelegramInputHandler } from './bot/TelegramInputHandler';
import { startAdminServer } from './admin/AdminServer';
import { OnboardManager } from './onboard/OnboardManager';
import { AutoUpdater } from './updater/AutoUpdater';
import { config } from './utils/config';
import { logger, captureLog } from './utils/logger';
import { telemetry } from './telemetry/TelemetryReporter';
import { logForwarder } from './telemetry/LogForwarder';

// Ensure required directories exist
[config.paths.data, config.paths.tmp, config.paths.logs, './output'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function main() {
  logger.info('============================================');
  logger.info(' BollaClaw v0.1 - Starting up...');
  logger.info('============================================');

  // Check onboard status
  const onboard = new OnboardManager();
  if (!onboard.isOnboarded()) {
    logger.warn('⚠️  Identidade não configurada! Execute: npm run onboard');
    logger.warn('   Usando configuração padrão...');
  } else {
    const identity = onboard.loadIdentity();
    logger.info(`Agent: ${identity.agentName} | Owner: ${identity.ownerName || '(not set)'}`);
  }

  logger.info(`LLM Provider: ${config.llm.provider} (providers.json or .env)`);
  logger.info(`STT: ${config.audio.sttProvider}`);
  logger.info(`Admin: ${config.admin.enabled ? `http://0.0.0.0:${config.admin.port}` : 'disabled'}`);
  logger.info(`Allowed users: ${config.telegram.allowedUserIds.join(', ')}`);
  captureLog('info', 'BollaClaw starting...');

  // Start telemetry reporter + log forwarder
  telemetry.start();
  logForwarder.start(telemetry.getInstanceId());

  // Start auto-updater
  const updateInterval = parseInt(process.env.AUTO_UPDATE_INTERVAL || '300000', 10); // 5min default
  const autoUpdateEnabled = process.env.AUTO_UPDATE !== 'disabled';
  const updater = new AutoUpdater({
    enabled: autoUpdateEnabled,
    checkIntervalMs: updateInterval,
    branch: process.env.AUTO_UPDATE_BRANCH || 'main',
    repoDir: process.cwd(),
    pm2Name: process.env.PM2_NAME || 'bollaclaw',
  });
  updater.start();

  const bot = new TelegramInputHandler();

  // Start admin panel with reference to controller
  startAdminServer(bot.getController());

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down...');
    captureLog('warn', 'Bot shutting down (SIGINT)');
    logForwarder.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down...');
    captureLog('warn', 'Bot shutting down (SIGTERM)');
    logForwarder.stop();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
    captureLog('error', `Uncaught exception: ${err.message}`);
    telemetry.trackError(err, 'uncaught_exception');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    captureLog('error', `Unhandled rejection: ${reason}`);
    telemetry.trackError(String(reason), 'unhandled_rejection');
  });

  // Start the bot
  await bot.start();
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err}`);
  process.exit(1);
});
