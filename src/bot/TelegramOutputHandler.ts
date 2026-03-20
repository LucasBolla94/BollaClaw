import { Context, InputFile } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import { AgentResult } from '../agent/AgentLoop';
import { AudioHandler } from '../handlers/AudioHandler';
import { logger } from '../utils/logger';

// ============================================================
// TelegramOutputHandler v2 — Formatted output with MarkdownV2
// ============================================================

const TELEGRAM_MAX_LENGTH = 4000; // Leave buffer under 4096

// File extension → emoji mapping for captions
const FILE_EMOJI: Record<string, string> = {
  '.pdf': '📄', '.docx': '📝', '.xlsx': '📊', '.xls': '📊',
  '.csv': '📋', '.json': '📦', '.html': '🌐', '.md': '📃',
  '.txt': '📃', '.py': '🐍', '.js': '⚙️', '.ts': '⚙️',
  '.zip': '📦', '.png': '🖼', '.jpg': '🖼', '.svg': '🎨',
};

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
    // Try MarkdownV2 first, fall back to plain text
    const formatted = this.formatForTelegram(text);

    if (formatted.length <= TELEGRAM_MAX_LENGTH) {
      try {
        await ctx.reply(formatted, { parse_mode: 'MarkdownV2' });
        return;
      } catch {
        // MarkdownV2 failed (bad formatting), try plain
        try {
          await ctx.reply(text);
          return;
        } catch (plainErr) {
          logger.warn(`Plain text also failed: ${plainErr}`);
          // Last resort: strip everything
          await ctx.reply(text.replace(/[*_`\[\]()~>#+\-=|{}.!\\]/g, ''));
          return;
        }
      }
    }

    // Chunk into multiple messages without breaking words
    const chunks = this.splitText(text, TELEGRAM_MAX_LENGTH);
    for (const chunk of chunks) {
      try {
        const fmtChunk = this.formatForTelegram(chunk);
        await ctx.reply(fmtChunk, { parse_mode: 'MarkdownV2' });
      } catch {
        await ctx.reply(chunk);
      }
      await this.sleep(300); // Avoid rate limiting
    }
  }

  private async sendFile(ctx: Context, filePath: string, caption?: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      logger.warn(`[Output] File not found: ${filePath}`);
      await this.sendText(ctx, caption ?? '⚠️ Arquivo gerado, mas não encontrado para envio.');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const emoji = FILE_EMOJI[ext] || '📎';
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    const sizeStr = fileSize > 1024 * 1024
      ? `${(fileSize / (1024 * 1024)).toFixed(1)}MB`
      : fileSize > 1024
        ? `${(fileSize / 1024).toFixed(1)}KB`
        : `${fileSize}B`;

    // Clean caption: remove [FILE:...] tags, trim
    let cleanCaption = (caption ?? '').replace(/\[FILE:[^\]]+\]/g, '').trim();
    if (!cleanCaption) {
      cleanCaption = `${emoji} ${fileName} (${sizeStr})`;
    } else {
      // Add file info to end of caption if not too long
      if (cleanCaption.length < 900) {
        cleanCaption += `\n\n${emoji} ${fileName} (${sizeStr})`;
      }
    }

    try {
      // Check Telegram file size limit (50MB)
      if (fileSize > 50 * 1024 * 1024) {
        await this.sendText(ctx, `⚠️ Arquivo muito grande para enviar via Telegram (${sizeStr}, limite: 50MB).`);
        return;
      }

      await ctx.replyWithDocument(new InputFile(filePath), {
        caption: cleanCaption.substring(0, 1024),
      });
    } catch (err) {
      logger.warn(`File send failed: ${err}`);

      // If it's a text file, try sending content inline
      if (['.md', '.txt', '.csv', '.json', '.html'].includes(ext) && fileSize < 3000) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          await this.sendText(ctx, `${cleanCaption}\n\n${content}`);
          return;
        } catch { /* fall through */ }
      }

      await this.sendText(ctx, `⚠️ Não consegui enviar o arquivo. ${cleanCaption}`);
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
    const safeMessage = message
      .replace(/sk-[a-zA-Z0-9-]+/g, '[API_KEY]')
      .replace(/ghp_[a-zA-Z0-9]+/g, '[GITHUB_TOKEN]');
    await ctx.reply(`⚠️ Erro: ${safeMessage}`).catch(() => {
      logger.error('Failed to send error message to user');
    });
  }

  async sendTyping(ctx: Context): Promise<void> {
    await ctx.replyWithChatAction('typing').catch(() => {});
  }

  // ── MarkdownV2 Formatting ─────────────────────────────────
  private formatForTelegram(text: string): string {
    // Telegram MarkdownV2 requires escaping special chars
    // But we want to preserve intentional formatting from the bot

    // Step 1: Protect code blocks
    const codeBlocks: string[] = [];
    let processed = text.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODEBLOCK_${codeBlocks.length - 1}__`;
    });

    // Step 2: Protect inline code
    const inlineCode: string[] = [];
    processed = processed.replace(/`[^`]+`/g, (match) => {
      inlineCode.push(match);
      return `__INLINE_${inlineCode.length - 1}__`;
    });

    // Step 3: Protect bold markers **text**
    const boldMatches: string[] = [];
    processed = processed.replace(/\*\*([^*]+)\*\*/g, (_match, content) => {
      boldMatches.push(content);
      return `__BOLD_${boldMatches.length - 1}__`;
    });

    // Step 4: Protect italic markers *text*
    const italicMatches: string[] = [];
    processed = processed.replace(/\*([^*]+)\*/g, (_match, content) => {
      italicMatches.push(content);
      return `__ITALIC_${italicMatches.length - 1}__`;
    });

    // Step 5: Escape all MarkdownV2 special characters
    processed = processed.replace(/([_\[\]()~>#+\-=|{}.!\\])/g, '\\$1');

    // Step 6: Restore formatting
    // Bold
    for (let i = 0; i < boldMatches.length; i++) {
      const escaped = boldMatches[i].replace(/([_\[\]()~>#+\-=|{}.!\\])/g, '\\$1');
      processed = processed.replace(`\\_\\_BOLD\\_${i}\\_\\_`, `*${escaped}*`);
    }

    // Italic
    for (let i = 0; i < italicMatches.length; i++) {
      const escaped = italicMatches[i].replace(/([_\[\]()~>#+\-=|{}.!\\])/g, '\\$1');
      processed = processed.replace(`\\_\\_ITALIC\\_${i}\\_\\_`, `_${escaped}_`);
    }

    // Inline code
    for (let i = 0; i < inlineCode.length; i++) {
      processed = processed.replace(`\\_\\_INLINE\\_${i}\\_\\_`, inlineCode[i]);
    }

    // Code blocks
    for (let i = 0; i < codeBlocks.length; i++) {
      processed = processed.replace(`\\_\\_CODEBLOCK\\_${i}\\_\\_`, codeBlocks[i]);
    }

    return processed;
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
