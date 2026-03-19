import 'dotenv/config';
import * as fs from 'fs';
import { TelegramInputHandler } from './bot/TelegramInputHandler';
import { startAdminServer } from './admin/AdminServer';
import { OnboardManager } from './onboard/OnboardManager';
import { config } from './utils/config';
import { logger, captureLog } from './utils/logger';

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

  logger.info(`Provider: ${config.llm.provider}`);
  logger.info(`STT: ${config.audio.sttProvider}`);
  logger.info(`Admin: ${config.admin.enabled ? `http://0.0.0.0:${config.admin.port}` : 'disabled'}`);
  logger.info(`Allowed users: ${config.telegram.allowedUserIds.join(', ')}`);
  captureLog('info', 'BollaClaw starting...');

  const bot = new TelegramInputHandler();

  // Start admin panel with reference to controller
  startAdminServer(bot.getController());

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down...');
    captureLog('warn', 'Bot shutting down (SIGINT)');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down...');
    captureLog('warn', 'Bot shutting down (SIGTERM)');
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
    captureLog('error', `Uncaught exception: ${err.message}`);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    captureLog('error', `Unhandled rejection: ${reason}`);
  });

  // Start the bot
  await bot.start();
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err}`);
  process.exit(1);
});
