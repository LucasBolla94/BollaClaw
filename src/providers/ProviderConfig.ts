import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ============================================================
// Provider Configuration System
// ============================================================
// Supports two modes:
//   1. providers.json file — full flexibility, any provider/model
//   2. .env vars (legacy) — backward compatible with V0.1 setup
//
// providers.json example:
// {
//   "default": "claude",
//   "router": "groq-fast",
//   "fallbackOrder": ["claude", "openrouter", "groq-fast"],
//   "providers": {
//     "claude": {
//       "type": "anthropic",
//       "apiKey": "${ANTHROPIC_API_KEY}",
//       "model": "claude-sonnet-4-5",
//       "maxTokens": 8192
//     },
//     "gpt4": {
//       "type": "openai",
//       "apiKey": "${OPENAI_API_KEY}",
//       "model": "gpt-4o",
//       "baseUrl": "https://api.openai.com/v1"
//     },
//     "openrouter": {
//       "type": "openai-compatible",
//       "apiKey": "${OPENROUTER_API_KEY}",
//       "model": "anthropic/claude-3.5-sonnet",
//       "baseUrl": "https://openrouter.ai/api/v1",
//       "headers": { "HTTP-Referer": "https://bollaclaw.bolla.network" }
//     },
//     "groq-fast": {
//       "type": "openai-compatible",
//       "apiKey": "${GROQ_API_KEY}",
//       "model": "llama-3.3-70b-versatile",
//       "baseUrl": "https://api.groq.com/openai/v1"
//     },
//     "deepseek": {
//       "type": "openai-compatible",
//       "apiKey": "${DEEPSEEK_API_KEY}",
//       "model": "deepseek-chat",
//       "baseUrl": "https://api.deepseek.com/v1"
//     },
//     "grok": {
//       "type": "openai-compatible",
//       "apiKey": "${XAI_API_KEY}",
//       "model": "grok-2",
//       "baseUrl": "https://api.x.ai/v1"
//     },
//     "gemini": {
//       "type": "gemini",
//       "apiKey": "${GEMINI_API_KEY}",
//       "model": "gemini-2.0-flash"
//     }
//   }
// }
// ============================================================

export type ProviderType = 'anthropic' | 'openai-compatible' | 'gemini';

export interface ProviderEntry {
  type: ProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;               // For OpenAI-compatible APIs
  maxTokens?: number;             // Max output tokens (default: 8192)
  headers?: Record<string, string>; // Extra headers (e.g., OpenRouter referer)
  temperature?: number;           // Default temperature
}

export interface ProvidersConfig {
  default: string;                  // Name of the default provider
  router?: string;                  // Provider for skill routing (cheap/fast)
  fallbackOrder?: string[];         // Fallback chain
  providers: Record<string, ProviderEntry>;
}

// Known OpenAI-compatible base URLs for convenience
const KNOWN_BASES: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai:     { baseUrl: 'https://api.openai.com/v1',       defaultModel: 'gpt-4o' },
  deepseek:   { baseUrl: 'https://api.deepseek.com/v1',     defaultModel: 'deepseek-chat' },
  groq:       { baseUrl: 'https://api.groq.com/openai/v1',  defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',    defaultModel: 'anthropic/claude-3.5-sonnet' },
  together:   { baseUrl: 'https://api.together.xyz/v1',     defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  fireworks:  { baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  xai:        { baseUrl: 'https://api.x.ai/v1',             defaultModel: 'grok-2' },
  mistral:    { baseUrl: 'https://api.mistral.ai/v1',       defaultModel: 'mistral-large-latest' },
  cerebras:   { baseUrl: 'https://api.cerebras.ai/v1',      defaultModel: 'llama-3.3-70b' },
};

/**
 * Resolve ${ENV_VAR} references in a string
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envName) => {
    return process.env[envName] ?? '';
  });
}

/**
 * Deep-resolve env vars in an object
 */
function resolveObjectEnvVars(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = resolveEnvVars(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = resolveObjectEnvVars(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Load providers config from providers.json or build from .env (legacy)
 */
export function loadProvidersConfig(): ProvidersConfig {
  const configPath = path.resolve(process.cwd(), 'providers.json');

  // Try providers.json first
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const resolved = resolveObjectEnvVars(parsed) as unknown as ProvidersConfig;

      // Enrich with known base URLs if type matches a known service
      for (const [name, entry] of Object.entries(resolved.providers)) {
        if (entry.type === 'openai-compatible' && !entry.baseUrl) {
          const known = KNOWN_BASES[name] ?? KNOWN_BASES[name.split('-')[0]];
          if (known) {
            entry.baseUrl = known.baseUrl;
            if (!entry.model) entry.model = known.defaultModel;
          }
        }
      }

      logger.info(`Loaded ${Object.keys(resolved.providers).length} providers from providers.json`);
      return resolved;
    } catch (err) {
      logger.error(`Failed to load providers.json: ${err}`);
    }
  }

  // Fallback: build from .env (legacy mode)
  return buildFromEnv();
}

/**
 * Build providers config from legacy .env variables
 */
function buildFromEnv(): ProvidersConfig {
  const providers: Record<string, ProviderEntry> = {};
  const defaultProvider = process.env.LLM_PROVIDER ?? 'claude';

  // Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    providers.claude = {
      type: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    };
  }

  // Gemini
  if (process.env.GEMINI_API_KEY) {
    providers.gemini = {
      type: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    };
  }

  // DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    providers.deepseek = {
      type: 'openai-compatible',
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    };
  }

  // Groq
  if (process.env.GROQ_API_KEY) {
    providers.groq = {
      type: 'openai-compatible',
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }

  // OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    providers.openrouter = {
      type: 'openai-compatible',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet',
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: { 'HTTP-Referer': 'https://bollaclaw.bolla.network' },
    };
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      type: 'openai-compatible',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    };
  }

  // xAI / Grok
  if (process.env.XAI_API_KEY) {
    providers.grok = {
      type: 'openai-compatible',
      apiKey: process.env.XAI_API_KEY,
      model: process.env.XAI_MODEL ?? 'grok-2',
      baseUrl: 'https://api.x.ai/v1',
    };
  }

  logger.info(`Built ${Object.keys(providers).length} providers from .env (legacy mode)`);

  return {
    default: defaultProvider,
    router: process.env.ROUTER_PROVIDER ?? 'groq',
    fallbackOrder: (process.env.FALLBACK_ORDER ?? '').split(',').map(s => s.trim()).filter(Boolean),
    providers,
  };
}

/**
 * Get known base URL info for a service name
 */
export function getKnownBase(name: string) {
  return KNOWN_BASES[name] ?? null;
}
