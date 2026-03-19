import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { execSync } from 'child_process';
import Groq from 'groq-sdk';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export class AudioHandler {
  private groqClient: Groq | null = null;
  private tmpDir: string;

  constructor() {
    this.tmpDir = config.paths.tmp;
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }

    if (config.audio.sttProvider === 'groq_whisper' && config.llm.groqApiKey) {
      this.groqClient = new Groq({ apiKey: config.llm.groqApiKey });
      logger.info('AudioHandler: Groq Whisper STT initialized');
    } else {
      logger.warn('AudioHandler: No STT provider configured. Audio transcription disabled.');
    }
  }

  async transcribeFromUrl(fileUrl: string, mimeType: string): Promise<string> {
    const ext = this.getExtension(mimeType);
    const tmpFile = path.join(this.tmpDir, `audio_${Date.now()}${ext}`);

    try {
      await this.downloadFile(fileUrl, tmpFile);
      const transcript = await this.transcribe(tmpFile);
      return transcript;
    } finally {
      this.cleanup(tmpFile);
    }
  }

  private async transcribe(filePath: string): Promise<string> {
    if (!this.groqClient) {
      throw new Error('No STT provider available. Please set GROQ_API_KEY.');
    }

    logger.info(`Transcribing audio: ${filePath}`);

    const transcription = await this.groqClient.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3-turbo',
      language: 'pt',
      response_format: 'text',
    });

    const text = typeof transcription === 'string' ? transcription : (transcription as { text: string }).text;
    logger.info(`Transcript: "${text.substring(0, 100)}"`);
    return text;
  }

  async synthesize(text: string): Promise<string | null> {
    // Use edge-tts if available via system call
    const outputFile = path.join(this.tmpDir, `tts_${Date.now()}.ogg`);
    const cleanText = text
      .replace(/[*_`#>]/g, '')  // Remove markdown
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // Remove links
      .trim();

    try {
      execSync(
        `edge-tts --voice "${config.audio.ttsVoice}" --text "${cleanText.replace(/"/g, "'")}" --write-media "${outputFile}"`,
        { timeout: 30000 }
      );

      if (fs.existsSync(outputFile)) {
        logger.info(`TTS generated: ${outputFile}`);
        return outputFile;
      }
    } catch (err) {
      logger.warn(`TTS synthesis failed (edge-tts not installed?): ${err}`);
    }

    return null;
  }

  cleanup(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      logger.warn(`Failed to cleanup temp file ${filePath}: ${err}`);
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      const timeout = setTimeout(() => reject(new Error('Download timeout')), 15000);

      protocol.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          clearTimeout(timeout);
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        this.cleanup(dest);
        reject(err);
      });
    });
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.mp4',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
    };
    return map[mimeType] ?? '.ogg';
  }
}
