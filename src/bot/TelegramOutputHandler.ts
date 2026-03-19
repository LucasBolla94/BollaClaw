import { Context, InputFile } from 'grammy';
import * as fs from 'fs';
import { AgentResult } from '../agent/AgentLoop';
import { AudioHandler } from '../handlers/AudioHandler';
import { logger } from '../utils/logger';

const TELEGRAM_MAX_LENGTH = 4000; // Leave some buffer under 4096

export class TelegramOutputHandler {
  private audioHandler: AudioHandler;

  constructor() {
    this.audioHandler = new AudioHandler();
  }

  async send(ctx: Context, result: AgentResult): Promise<void> {
    try {
      if (result.isAudioOutput) {
        await this.sendAudio(ctx, result.answer);
        return;
      }

      if (result.isFileOutput && result.filePath) {
        await this.sendFile(ctx, result.filePath, result.answer);
        return;
      }

      await this.sendText(ctx, result.answer);
    } catch (err) {
      logger.error(`TelegramOutputHandler error: ${err}`);
      await this.sendError(ctx, String(err));
    }
  }

  private async sendText(ctx: Context, text: string): Promise<void> {
    if (text.length <= TELEGRAM_MAX_LENGTH) {
      await ctx.reply(text);
      return;
    }

    // Chunk into multiple messages without breaking words
    const chunks = this.splitText(text, TELEGRAM_MAX_LENGTH);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
      await this.sleep(300); // Avoid rate limiting
    }
  }

  private async sendFile(ctx: Context, filePath: string, caption?: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      await this.sendText(ctx, caption ?? 'Arquivo gerado, mas não encontrado para envio.');
      return;
    }

    try {
      await ctx.replyWithDocument(new InputFile(filePath), {
        caption: caption?.substring(0, 1024),
      });
    } catch (err) {
      logger.warn(`File send failed, falling back to text: ${err}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      await this.sendText(ctx, `${caption ?? ''}\n\n${content}`);
    }
  }

  private async sendAudio(ctx: Context, text: string): Promise<void> {
    await ctx.replyWithChatAction('record_voice');

    const audioPath = await this.audioHandler.synthesize(text);

    if (audioPath) {
      try {
        await ctx.replyWithVoice(new InputFile(audioPath));
      } catch (err) {
        logger.warn(`Voice send failed, falling back to text: ${err}`);
        await this.sendText(ctx, text);
      } finally {
        this.audioHandler.cleanup(audioPath);
      }
    } else {
      // TTS not available, fall back to text
      await this.sendText(ctx, text);
    }
  }

  async sendError(ctx: Context, message: string): Promise<void> {
    const safeMessage = message.replace(/sk-[a-zA-Z0-9-]+/g, '[API_KEY]'); // Never expose keys
    await ctx.reply(`⚠️ Erro: ${safeMessage}`).catch(() => {
      logger.error('Failed to send error message to user');
    });
  }

  async sendTyping(ctx: Context): Promise<void> {
    await ctx.replyWithChatAction('typing').catch(() => {});
  }

  private splitText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find last newline or space within limit
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength * 0.5) splitAt = remaining.lastIndexOf(' ', maxLength);
      if (splitAt < 0) splitAt = maxLength;

      chunks.push(remaining.substring(0, splitAt).trim());
      remaining = remaining.substring(splitAt).trim();
    }

    return chunks.filter(Boolean);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
