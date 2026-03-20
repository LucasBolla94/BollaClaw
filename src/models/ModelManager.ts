import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// ModelManager — Fetch, cache, and manage available LLM models
// ============================================================
// Fetches model lists from connected provider APIs.
// For OpenRouter: downloads full catalog with pricing.
// Caches locally to avoid repeated API calls.
// ============================================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  pricingPrompt: number;    // USD per 1M tokens
  pricingCompletion: number; // USD per 1M tokens
  isFree: boolean;
  description?: string;
  modality?: string;
}

export interface ModelCache {
  fetchedAt: string;
  provider: string;
  models: ModelInfo[];
}

const CACHE_FILE = 'models-cache.json';
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Provider-specific model definitions ──────────────────────

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', contextLength: 200000, maxOutput: 16384, pricingPrompt: 15, pricingCompletion: 75, isFree: false, description: 'Mais inteligente — melhor para agentes' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', contextLength: 200000, maxOutput: 16384, pricingPrompt: 3, pricingCompletion: 15, isFree: false, description: 'Custo-benefício — rápido e capaz' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', contextLength: 200000, maxOutput: 8192, pricingPrompt: 1, pricingCompletion: 5, isFree: false, description: 'Mais rápido e barato' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', contextLength: 200000, maxOutput: 16384, pricingPrompt: 3, pricingCompletion: 15, isFree: false, description: 'Versão anterior — estável' },
];

const OPENAI_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000, maxOutput: 16384, pricingPrompt: 2.5, pricingCompletion: 10, isFree: false, description: 'Multimodal — texto, imagem, áudio' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000, maxOutput: 16384, pricingPrompt: 0.15, pricingCompletion: 0.60, isFree: false, description: 'Rápido e econômico' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextLength: 128000, maxOutput: 4096, pricingPrompt: 10, pricingCompletion: 30, isFree: false, description: 'Versão turbo — estável' },
];

const XAI_MODELS: ModelInfo[] = [
  { id: 'grok-4', name: 'Grok 4', provider: 'xai', contextLength: 131072, maxOutput: 16384, pricingPrompt: 3, pricingCompletion: 15, isFree: false, description: 'Raciocínio profundo' },
  { id: 'grok-4-fast', name: 'Grok 4 Fast', provider: 'xai', contextLength: 131072, maxOutput: 16384, pricingPrompt: 1, pricingCompletion: 5, isFree: false, description: 'Rápido com raciocínio' },
  { id: 'grok-code-fast-1', name: 'Grok Code Fast', provider: 'xai', contextLength: 262144, maxOutput: 16384, pricingPrompt: 0.15, pricingCompletion: 0.60, isFree: false, description: 'Coding — 256K context' },
];

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'deepseek', contextLength: 65536, maxOutput: 8192, pricingPrompt: 0.27, pricingCompletion: 1.10, isFree: false, description: 'Custo ultra-baixo' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek', contextLength: 65536, maxOutput: 8192, pricingPrompt: 0.55, pricingCompletion: 2.19, isFree: false, description: 'Raciocínio profundo — barato' },
];

const GEMINI_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', contextLength: 1048576, maxOutput: 65536, pricingPrompt: 1.25, pricingCompletion: 10, isFree: false, description: '1M context — raciocínio' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', contextLength: 1048576, maxOutput: 65536, pricingPrompt: 0.15, pricingCompletion: 0.60, isFree: false, description: '1M context — ultra rápido' },
];

const GROQ_MODELS: ModelInfo[] = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', contextLength: 32768, maxOutput: 8192, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Meta — gratuito no Groq' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', provider: 'groq', contextLength: 131072, maxOutput: 8192, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Ultra rápido — gratuito' },
  { id: 'gemma2-9b-it', name: 'Gemma 2 9B', provider: 'groq', contextLength: 8192, maxOutput: 4096, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Google — gratuito no Groq' },
];

export class ModelManager {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  // ── Get models for a specific provider ─────────────────────

  getStaticModels(provider: string): ModelInfo[] {
    switch (provider.toLowerCase()) {
      case 'anthropic':
      case 'claude':
        return ANTHROPIC_MODELS;
      case 'openai':
        return OPENAI_MODELS;
      case 'xai':
        return XAI_MODELS;
      case 'deepseek':
        return DEEPSEEK_MODELS;
      case 'gemini':
        return GEMINI_MODELS;
      case 'groq':
        return GROQ_MODELS;
      default:
        return [];
    }
  }

  // ── OpenRouter: Fetch live model catalog ───────────────────

  async fetchOpenRouterModels(apiKey: string): Promise<ModelInfo[]> {
    const cache = this.readCache('openrouter');
    if (cache) return cache.models;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://openclaw.ai',
          'X-Title': 'BollaClaw',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as {
        data: Array<{
          id: string;
          name: string;
          description?: string;
          context_length: number;
          top_provider?: { max_completion_tokens?: number };
          pricing: { prompt: string; completion: string };
          architecture?: { modality?: string };
        }>;
      };

      const models: ModelInfo[] = data.data
        .filter((m) => {
          // Filter out deprecated and non-text models
          const id = m.id.toLowerCase();
          return !id.includes('deprecated') && !id.includes('preview');
        })
        .map((m) => {
          const promptPrice = parseFloat(m.pricing?.prompt || '0') * 1_000_000;
          const completionPrice = parseFloat(m.pricing?.completion || '0') * 1_000_000;

          return {
            id: m.id,
            name: m.name || m.id,
            provider: 'openrouter',
            contextLength: m.context_length || 0,
            maxOutput: m.top_provider?.max_completion_tokens || 4096,
            pricingPrompt: Math.round(promptPrice * 100) / 100,
            pricingCompletion: Math.round(completionPrice * 100) / 100,
            isFree: promptPrice === 0 && completionPrice === 0,
            description: m.description?.substring(0, 80),
            modality: m.architecture?.modality,
          };
        })
        .sort((a, b) => {
          // Free first, then by prompt price
          if (a.isFree && !b.isFree) return -1;
          if (!a.isFree && b.isFree) return 1;
          return a.pricingPrompt - b.pricingPrompt;
        });

      // Cache for 6 hours
      this.writeCache('openrouter', models);

      return models;
    } catch (err) {
      // Return cached even if expired
      const expired = this.readCache('openrouter', true);
      if (expired) return expired.models;
      throw err;
    }
  }

  // ── Get curated "best" models for OpenRouter/OpenClaw ──────

  getCuratedOpenRouterModels(): ModelInfo[] {
    return [
      // Free tier
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'openrouter', contextLength: 131072, maxOutput: 8192, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Meta — gratuito, forte em geral' },
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B (Free)', provider: 'openrouter', contextLength: 8192, maxOutput: 4096, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Google — gratuito, compacto' },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Free)', provider: 'openrouter', contextLength: 32768, maxOutput: 4096, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Mistral — gratuito, rápido' },
      { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B (Free)', provider: 'openrouter', contextLength: 32768, maxOutput: 8192, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'Alibaba — gratuito, poderoso' },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', provider: 'openrouter', contextLength: 65536, maxOutput: 8192, pricingPrompt: 0, pricingCompletion: 0, isFree: true, description: 'DeepSeek — raciocínio gratuito' },
      // Paid - best value
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'openrouter', contextLength: 200000, maxOutput: 16384, pricingPrompt: 3, pricingCompletion: 15, isFree: false, description: 'Anthropic — melhor custo-benefício' },
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'openrouter', contextLength: 200000, maxOutput: 16384, pricingPrompt: 15, pricingCompletion: 75, isFree: false, description: 'Anthropic — mais inteligente' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter', contextLength: 128000, maxOutput: 16384, pricingPrompt: 2.5, pricingCompletion: 10, isFree: false, description: 'OpenAI — multimodal' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openrouter', contextLength: 128000, maxOutput: 16384, pricingPrompt: 0.15, pricingCompletion: 0.60, isFree: false, description: 'OpenAI — barato' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'openrouter', contextLength: 1048576, maxOutput: 65536, pricingPrompt: 1.25, pricingCompletion: 10, isFree: false, description: 'Google — 1M context' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'openrouter', contextLength: 1048576, maxOutput: 65536, pricingPrompt: 0.15, pricingCompletion: 0.60, isFree: false, description: 'Google — ultra rápido' },
      { id: 'x-ai/grok-4', name: 'Grok 4', provider: 'openrouter', contextLength: 131072, maxOutput: 16384, pricingPrompt: 3, pricingCompletion: 15, isFree: false, description: 'xAI — raciocínio profundo' },
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3', provider: 'openrouter', contextLength: 65536, maxOutput: 8192, pricingPrompt: 0.27, pricingCompletion: 1.10, isFree: false, description: 'DeepSeek — 1/50x custo' },
      { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', provider: 'openrouter', contextLength: 131072, maxOutput: 8192, pricingPrompt: 0.16, pricingCompletion: 0.60, isFree: false, description: 'Alibaba — coding especialista' },
      { id: 'mistralai/codestral-latest', name: 'Codestral', provider: 'openrouter', contextLength: 32768, maxOutput: 8192, pricingPrompt: 0.30, pricingCompletion: 0.90, isFree: false, description: 'Mistral — coding forte' },
    ];
  }

  // ── Cache ──────────────────────────────────────────────────

  private readCache(provider: string, allowExpired = false): ModelCache | null {
    const filePath = path.join(this.dataDir, `${provider}-${CACHE_FILE}`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ModelCache;
      const age = Date.now() - new Date(data.fetchedAt).getTime();
      if (age > CACHE_MAX_AGE_MS && !allowExpired) return null;
      return data;
    } catch {
      return null;
    }
  }

  private writeCache(provider: string, models: ModelInfo[]): void {
    const filePath = path.join(this.dataDir, `${provider}-${CACHE_FILE}`);
    const cache: ModelCache = {
      fetchedAt: new Date().toISOString(),
      provider,
      models,
    };
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');
  }

  // ── Change model in .env ───────────────────────────────────

  changeModel(envPath: string, newModelId: string): boolean {
    if (!fs.existsSync(envPath)) return false;

    let content = fs.readFileSync(envPath, 'utf-8');

    if (content.includes('LLM_MODEL=')) {
      content = content.replace(/LLM_MODEL=.*/, `LLM_MODEL=${newModelId}`);
    } else {
      // Add after LLM_PROVIDER line
      content = content.replace(
        /(LLM_PROVIDER=.*\n)/,
        `$1LLM_MODEL=${newModelId}\n`
      );
    }

    fs.writeFileSync(envPath, content, 'utf-8');
    return true;
  }

  // ── Get current model from .env ────────────────────────────

  getCurrentModel(envPath: string): { provider: string; model: string } | null {
    if (!fs.existsSync(envPath)) return null;

    const content = fs.readFileSync(envPath, 'utf-8');
    const providerMatch = content.match(/LLM_PROVIDER=(.*)/);
    const modelMatch = content.match(/LLM_MODEL=(.*)/);

    if (!providerMatch) return null;

    return {
      provider: providerMatch[1].trim(),
      model: modelMatch ? modelMatch[1].trim() : '(padrão)',
    };
  }

  // ── Format helpers ─────────────────────────────────────────

  static formatPrice(price: number): string {
    if (price === 0) return 'GRÁTIS';
    if (price < 0.01) return `$${price.toFixed(4)}`;
    if (price < 1) return `$${price.toFixed(2)}`;
    return `$${price.toFixed(2)}`;
  }

  static formatContext(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
    return String(tokens);
  }
}
