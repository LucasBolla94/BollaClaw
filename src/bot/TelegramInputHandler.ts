import { Bot, Context } from 'grammy';
import { AgentController } from '../agent/AgentController';
import { TelegramOutputHandler } from './TelegramOutputHandler';
import { DocumentHandler } from '../handlers/DocumentHandler';
import { AudioHandler } from '../handlers/AudioHandler';
import { UserManager } from '../auth/UserManager';
import { config } from '../utils/config';
import { logger, captureLog, logBuffer } from '../utils/logger';

export class TelegramInputHandler {
  private bot: Bot;
  private controller: AgentController;
  private output: TelegramOutputHandler;
  private documentHandler: DocumentHandler;
  private audioHandler: AudioHandler;
  private userManager: UserManager;

  constructor() {
    this.bot = new Bot(config.telegram.botToken);
    this.controller = new AgentController();
    this.output = new TelegramOutputHandler();
    this.documentHandler = new DocumentHandler();
    this.audioHandler = new AudioHandler();
    this.userManager = new UserManager();

    // Seed approved users from .env (migration from old TELEGRAM_ALLOWED_USER_IDS)
    const envIds = config.telegram.allowedUserIds;
    if (envIds && envIds.length > 0 && envIds[0] !== '') {
      this.userManager.seedFromEnv(envIds);
    }
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
    // Global access control middleware
    this.bot.use(async (ctx, next) => {
      const userId = String(ctx.from?.id ?? '');
      if (!userId) return;

      // Check if user is approved
      if (this.userManager.isApproved(userId)) {
        await next();
        return;
      }

      // /start is allowed for everyone (shows welcome + access request)
      if (ctx.message && 'text' in ctx.message && ctx.message.text === '/start') {
        await this.handleUnauthorizedStart(ctx, userId);
        return;
      }

      // Unknown user — generate code and send instructions
      await this.handleUnauthorizedUser(ctx, userId);
    });

    // /start command
    this.bot.command('start', async (ctx) => {
      const userId = String(ctx.from?.id ?? '');
      await ctx.reply(
        `👋 Olá! Sou o *BollaClaw*, seu assistente pessoal de IA.\n\n` +
        `Envie uma mensagem, arquivo PDF ou nota de voz para começar.\n\n` +
        `_Seu ID: \`${userId}\`_`,
        { parse_mode: 'Markdown' }
      );
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      const status = this.controller.getStatus();
      const userId = String(ctx.from?.id ?? '');
      const isAdmin = this.userManager.isAdmin(userId);
      const adminBadge = isAdmin ? ' 👑' : '';

      const msg = [
        `🟢 *BollaClaw Status*${adminBadge}`,
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

    // /myid command — show user's Telegram ID
    this.bot.command('myid', async (ctx) => {
      const userId = String(ctx.from?.id ?? '');
      await ctx.reply(`Seu Telegram ID: \`${userId}\``, { parse_mode: 'Markdown' });
    });

    // /invite command (admin only) — show pending codes
    this.bot.command('invite', async (ctx) => {
      const userId = String(ctx.from?.id ?? '');
      if (!this.userManager.isAdmin(userId)) {
        await ctx.reply('🔒 Apenas admins podem usar este comando.');
        return;
      }

      const pending = this.userManager.listPending();
      if (pending.length === 0) {
        await ctx.reply('✅ Nenhuma solicitação pendente.');
        return;
      }

      let msg = `📋 *Solicitações pendentes (${pending.length}):*\n\n`;
      for (const p of pending) {
        msg += `• *${p.telegramName}* (ID: \`${p.telegramId}\`)\n`;
        msg += `  Código: \`${p.code}\`\n`;
        msg += `  Comando: \`bollaclaw add ${p.code}\`\n\n`;
      }
      await ctx.reply(msg, { parse_mode: 'Markdown' });
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

  // ── Unauthorized user handlers ───────────────────────────

  private async handleUnauthorizedStart(ctx: Context, userId: string): Promise<void> {
    const userName = this.getUserDisplayName(ctx);
    const pending = this.userManager.requestAccess(userId, userName);

    await ctx.reply(
      `👋 Olá *${userName}*!\n\n` +
      `Eu sou o *BollaClaw*, um assistente pessoal de IA.\n\n` +
      `🔒 Seu acesso ainda não foi autorizado.\n\n` +
      `Para ser adicionado, peça ao administrador para executar no servidor:\n\n` +
      `\`bollaclaw add ${pending.code}\`\n\n` +
      `_Seu código expira em 48 horas._\n` +
      `_Seu ID: \`${userId}\`_`,
      { parse_mode: 'Markdown' }
    );

    logger.info(`Access requested by ${userName} (${userId}), code: ${pending.code}`);
  }

  private async handleUnauthorizedUser(ctx: Context, userId: string): Promise<void> {
    const userName = this.getUserDisplayName(ctx);
    const pending = this.userManager.requestAccess(userId, userName);

    await ctx.reply(
      `🔒 *Acesso não autorizado*\n\n` +
      `Para usar o BollaClaw, peça ao administrador:\n\n` +
      `\`bollaclaw add ${pending.code}\`\n\n` +
      `_Código: \`${pending.code}\` • Expira em 48h_`,
      { parse_mode: 'Markdown' }
    );
  }

  private getUserDisplayName(ctx: Context): string {
    const from = ctx.from;
    if (!from) return 'Usuário';
    if (from.first_name && from.last_name) return `${from.first_name} ${from.last_name}`;
    if (from.first_name) return from.first_name;
    if (from.username) return from.username;
    return 'Usuário';
  }

  private detectAudioRequest(text: string): boolean {
    const keywords = ['responda em áudio', 'fale comigo', 'responde em áudio', 'me responda em voz'];
    return keywords.some((k) => text.toLowerCase().includes(k));
  }
}
