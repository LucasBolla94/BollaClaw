import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';

// ============================================================
// EmbeddingService — Local Embeddings via ONNX (no GPU, no API)
// ============================================================
// Uses a lightweight Python script with fastembed (ONNX Runtime)
// to generate embeddings locally on CPU.
// Model: BAAI/bge-small-en-v1.5 — 384 dimensions, ~33MB
// Multilingual alternative: intfloat/multilingual-e5-large
// ============================================================

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export class EmbeddingService {
  private pythonPath: string;
  private scriptPath: string;
  private model: string;
  private dimensions: number;
  private ready = false;

  constructor(options?: { model?: string; dimensions?: number }) {
    this.model = options?.model || 'BAAI/bge-small-en-v1.5';
    this.dimensions = options?.dimensions || 384;
    this.pythonPath = 'python3';
    this.scriptPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'embed.py');
  }

  getDimensions(): number {
    return this.dimensions;
  }

  // ── Ensure Python + fastembed are installed ────────────────

  async ensureReady(): Promise<boolean> {
    if (this.ready) return true;

    try {
      // Check if Python3 exists
      execSync('python3 --version', { encoding: 'utf-8', timeout: 5000 });

      // Check if fastembed is installed
      const check = execSync('python3 -c "import fastembed; print(\'ok\')"', {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();

      if (check === 'ok') {
        this.ready = true;
        return true;
      }
    } catch {
      logger.warn('[EmbeddingService] fastembed not installed. Installing...');
      try {
        execSync('pip3 install fastembed --break-system-packages -q', {
          encoding: 'utf-8',
          timeout: 120000,
        });
        this.ready = true;
        return true;
      } catch (err) {
        logger.error(`[EmbeddingService] Failed to install fastembed: ${err}`);
        return false;
      }
    }

    return false;
  }

  // ── Generate embeddings for text(s) ───────────────────────

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.ready) await this.ensureReady();
    if (!this.ready) throw new Error('EmbeddingService not ready');

    // For small batches, use inline Python
    if (texts.length <= 5) {
      return this.embedInline(texts);
    }

    // For larger batches, use file-based approach
    return this.embedViaTmpFile(texts);
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  // ── Private: inline embedding for small batches ───────────

  private embedInline(texts: string[]): number[][] {
    const escaped = JSON.stringify(texts);
    const script = `
import json, sys
from fastembed import TextEmbedding

model = TextEmbedding("${this.model}")
texts = json.loads('''${escaped}''')
embeddings = list(model.embed(texts))
result = [e.tolist() for e in embeddings]
print(json.dumps(result))
`;

    try {
      const output = execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        timeout: 60000,
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });

      return JSON.parse(output.trim());
    } catch (err) {
      // Fallback: use tmp file approach
      return this.embedViaTmpFile(texts);
    }
  }

  // ── Private: file-based embedding for large batches ───────

  private embedViaTmpFile(texts: string[]): number[][] {
    const tmpDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const inputPath = path.join(tmpDir, `embed-input-${Date.now()}.json`);
    const outputPath = path.join(tmpDir, `embed-output-${Date.now()}.json`);

    try {
      fs.writeFileSync(inputPath, JSON.stringify(texts), 'utf-8');

      const script = `
import json
from fastembed import TextEmbedding

with open("${inputPath}") as f:
    texts = json.load(f)

model = TextEmbedding("${this.model}")
embeddings = list(model.embed(texts))
result = [e.tolist() for e in embeddings]

with open("${outputPath}", "w") as f:
    json.dump(result, f)
`;

      execSync(`python3 -c '${script.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        timeout: 300000, // 5min for large batches
        maxBuffer: 50 * 1024 * 1024,
      });

      const output = fs.readFileSync(outputPath, 'utf-8');
      return JSON.parse(output);
    } finally {
      // Cleanup
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    }
  }

  // ── Cosine similarity ─────────────────────────────────────

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }
}
