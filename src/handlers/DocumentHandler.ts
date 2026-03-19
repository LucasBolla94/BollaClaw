import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import pdfParse from 'pdf-parse';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_TEXT_LENGTH = 50000; // characters

export class DocumentHandler {
  private tmpDir: string;

  constructor() {
    this.tmpDir = config.paths.tmp;
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  async extractFromUrl(fileUrl: string, mimeType: string, caption?: string): Promise<string> {
    const ext = mimeType === 'application/pdf' ? '.pdf' : '.md';
    const tmpFile = path.join(this.tmpDir, `doc_${Date.now()}${ext}`);

    try {
      await this.downloadFile(fileUrl, tmpFile);

      const stats = fs.statSync(tmpFile);
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (max 20MB)`);
      }

      let text: string;
      if (ext === '.pdf') {
        text = await this.parsePdf(tmpFile);
      } else {
        text = fs.readFileSync(tmpFile, 'utf-8');
      }

      if (text.length > MAX_TEXT_LENGTH) {
        text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[... conteúdo truncado ...]';
      }

      const prefix = caption ? `Legenda: ${caption}\n\nConteúdo do arquivo:\n` : 'Conteúdo do arquivo:\n';
      return prefix + text;
    } finally {
      this.cleanup(tmpFile);
    }
  }

  private async parsePdf(filePath: string): Promise<string> {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  private cleanup(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn(`Failed to cleanup ${filePath}: ${err}`);
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      const timeout = setTimeout(() => reject(new Error('Download timeout after 15s')), 15000);

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
}
