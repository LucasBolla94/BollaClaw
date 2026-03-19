import { Bot, Context } from 'grammy';
import { AgentController } from '../agent/AgentController';
import { TelegramOutputHandler } from './TelegramOutputHandler';
import { DocumentHandler } from '../handlers/DocumentHandler';
import { AudioHandler } from '../handlers/AudioHandler';
import { config } from '../utils/config';
import { logger, captureLog, logBuffer } from '../utils/logger';

export class TelegramInputHandler {
  private bot: Bot;
  private controller: AgentController;
  private output: TelegramOutputHandler;
  private documentHandler: DocumentHandler;
  private audioHandler: AudioHandler;
  private allowedUserIds: Set<string>;

  constructor() {
    this.bot = new Bot(config.telegram.botToken);
    this.controller = new AgentController();
    this.output = new TelegramOutputHandler();
    this.documentHandler = new DocumentHandler();
    this.audioHandler = new AudioHandler();
    this.allowedUserIds = new Set(config.telegram.allowedUserIds);
  }

  async start(): Promise<void> {
    await this.controller.initialize();
    this.registerHandlers();

    logger.info('Starting Telegram bot...');
    await this.bot.start({
      onStart: (info) => {
        logger.info(`BollaClaw bot started: @${info.username}`);
        captureLog('info', `Bot online: @${info.username}`);
      },
    });
  }

  getBot(): Bot {
    return this.bot;
  }

  getController(): AgentController {
    return this.controller;
  }

  private registerHandlers(): void {
    // Global whitelist middleware
    this.bot.use(async (ctx, next) => {
      const userId = String(ctx.from?.id ?? '');
      if (!this.isAllowed(userId)) {
        logger.warn(`Blocked unauthorized user: ${userId}`);
        return; // Silent ignore
      }
      await next();
    });

    // /start command
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '👋 Olá! Sou o *BollaClaw*, seu assistente pessoal de IA.\n\nEnvie uma mensagem, arquivo PDF ou nota de voz para começar.',
        { parse_mode: 'Markdown' }
      );
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      const status = this.controller.getStatus();
      const msg = [
        `🟢 *BollaClaw Status*`,
        `Provider: \`${status.defaultProvider}\``,
        `Models: ${status.providers.map((p) => `${p.name}(${p.model})`).join(', ')}`,
        `Skills: ${status.skills.length} (${status.skills.map((s) => s.name).join(', ') || 'none'})`,
        `Tools: ${status.tools.join(', ')}`,
      ].join('\n');
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // /reload command - hot-reload skills
    this.bot.command('reload', async (ctx) => {
      this.controller.reloadSkills();
      await ctx.reply('✅ Skills recarregadas!');
    });

    // Text messages
    this.bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      const userId = String(ctx.from.id);

      if (text.startsWith('/')) return; // Skip unhandled commands

      await this.output.sendTyping(ctx);
      logger.info(`Text from ${userId}: "${text.substring(0, 80)}"`);

      // Detect audio reply keyword
      const requiresAudio = config.audio.autoAudioReply && this.detectAudioRequest(text);

      try {
        const result = await this.controller.process(userId, text, requiresAudio);
        await this.output.send(ctx, result);
      } catch (err) {
        logger.error(`Processing error: ${err}`);
        await this.output.sendError(ctx, 'Erro interno ao processar sua mensagem.');
      }
    });

    // Document messages (PDF, MD)
    this.bot.on('message:document', async (ctx) => {
      const doc = ctx.message.document;
      const userId = String(ctx.from.id);
      const supportedTypes = ['application/pdf', 'text/markdown', 'text/plain'];
      const isMarkdown = doc.file_name?.endsWith('.md');

      if (!supportedTypes.includes(doc.mime_type ?? '') && !isMarkdown) {
        await ctx.reply('⚠️ Formato não suportado. Aceito apenas PDF, .md ou .txt');
        return;
      }

      await ctx.replyWithChatAction('upload_document');

      try {
        const fileInfo = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${fileInfo.file_path}`;
        const caption = ctx.message.caption ?? '';

        const extractedText = await this.documentHandler.extractFromUrl(
          fileUrl,
          doc.mime_type ?? 'text/plain',
          caption
        );

        await this.output.sendTyping(ctx);
        const result = await this.controller.process(userId, extractedText, false);
        await this.output.send(ctx, result);
      } catch (err) {
        logger.error(`Document processing error: ${err}`);
        await this.output.sendError(ctx, String(err));
      }
    });

    // Voice messages
    this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
      const userId = String(ctx.from.id);
      const media = 'voice' in ctx.message ? ctx.message.voice : ctx.message.audio;
      if (!media) return;

      await ctx.replyWithChatAction('record_voice');

      try {
        const fileInfo = await ctx.api.getFile(media.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${fileInfo.file_path}`;
        const mimeType = ('mime_type' in media ? (media as any).mime_type : undefined) ?? 'audio/ogg';

        const transcript = await this.audioHandler.transcribeFromUrl(fileUrl, mimeType);

        if (!transcript.trim()) {
          await ctx.reply('🔇 Áudio vazio ou inaudível. Pode reenviar?');
          return;
        }

        logger.info(`Voice transcript from ${userId}: "${transcript.substring(0, 80)}"`);

        await this.output.sendTyping(ctx);
        // Auto-reply with audio when input is voice
        const result = await this.controller.process(userId, transcript, config.audio.autoAudioReply);
        await this.output.send(ctx, result);
      } catch (err) {
        logger.error(`Audio processing error: ${err}`);
        await this.output.sendError(ctx, `Falha ao processar áudio: ${String(err)}`);
      }
    });

    // Error handler
    this.bot.catch((err) => {
      logger.error(`Bot error: ${err.message}`);
      captureLog('error', `Bot error: ${err.message}`);
    });
  }

  private isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) return false;
    return this.allowedUserIds.has(userId);
  }

  private detectAudioRequest(text: string): boolean {
    const keywords = ['responda em áudio', 'fale comigo', 'responde em áudio', 'me responda em voz'];
    return keywords.some((k) => text.toLowerCase().includes(k));
  }
}
