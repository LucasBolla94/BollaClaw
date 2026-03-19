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
  openai:     { baseUrl: 'https://api.openai.com/v1',            defaultModel: 'gpt-5.4' },
  deepseek:   { baseUrl: 'https://api.deepseek.com/v1',          defaultModel: 'deepseek-chat' },
  groq:       { baseUrl: 'https://api.groq.com/openai/v1',       defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',         defaultModel: 'anthropic/claude-opus-4-6' },
  together:   { baseUrl: 'https://api.together.xyz/v1',          defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  fireworks:  { baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  xai:        { baseUrl: 'https://api.x.ai/v1',                  defaultModel: 'grok-4' },
  mistral:    { baseUrl: 'https://api.mistral.ai/v1',            defaultModel: 'mistral-large-latest' },
  cerebras:   { baseUrl: 'https://api.cerebras.ai/v1',           defaultModel: 'llama-3.3-70b' },
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
  const llmProvider = process.env.LLM_PROVIDER ?? 'anthropic';
  const llmModel = process.env.LLM_MODEL ?? '';
  const llmBaseUrl = process.env.LLM_BASE_URL ?? '';

  // ── Map LLM_PROVIDER → provider type + base URL ──
  const PROVIDER_MAP: Record<string, { type: ProviderType; baseUrl?: string; defaultModel: string; envKey: string }> = {
    anthropic:   { type: 'anthropic',          defaultModel: 'claude-sonnet-4-6', envKey: 'ANTHROPIC_API_KEY' },
    claude:      { type: 'anthropic',          defaultModel: 'claude-sonnet-4-6', envKey: 'ANTHROPIC_API_KEY' },
    openai:      { type: 'openai-compatible',  baseUrl: 'https://api.openai.com/v1',      defaultModel: 'gpt-5.4',        envKey: 'OPENAI_API_KEY' },
    xai:         { type: 'openai-compatible',  baseUrl: 'https://api.x.ai/v1',            defaultModel: 'grok-4',         envKey: 'XAI_API_KEY' },
    grok:        { type: 'openai-compatible',  baseUrl: 'https://api.x.ai/v1',            defaultModel: 'grok-4',         envKey: 'XAI_API_KEY' },
    openrouter:  { type: 'openai-compatible',  baseUrl: 'https://openrouter.ai/api/v1',   defaultModel: 'anthropic/claude-opus-4-6', envKey: 'OPENROUTER_API_KEY' },
    deepseek:    { type: 'openai-compatible',  baseUrl: 'https://api.deepseek.com/v1',    defaultModel: 'deepseek-chat',  envKey: 'DEEPSEEK_API_KEY' },
    groq:        { type: 'openai-compatible',  baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', envKey: 'GROQ_API_KEY' },
    gemini:      { type: 'gemini',             defaultModel: 'gemini-2.5-flash',           envKey: 'GEMINI_API_KEY' },
  };

  // ── Register PRIMARY provider from wizard settings ──
  const primaryMapping = PROVIDER_MAP[llmProvider] ?? PROVIDER_MAP.anthropic;
  const primaryApiKey = process.env[primaryMapping.envKey] ?? '';

  if (primaryApiKey) {
    const primaryEntry: ProviderEntry = {
      type: primaryMapping.type,
      apiKey: primaryApiKey,
      model: llmModel || primaryMapping.defaultModel,
    };
    if (llmBaseUrl) {
      primaryEntry.baseUrl = llmBaseUrl;
    } else if (primaryMapping.baseUrl) {
      primaryEntry.baseUrl = primaryMapping.baseUrl;
    }
    if (llmProvider === 'openrouter') {
      primaryEntry.headers = { 'HTTP-Referer': 'https://bollaclaw.bolla.network' };
    }
    providers[llmProvider] = primaryEntry;
  }

  // ── Register FALLBACK providers (any extra API keys) ──
  const fallbackDefs: Array<{ name: string; envKey: string; type: ProviderType; baseUrl?: string; defaultModel: string }> = [
    { name: 'anthropic',  envKey: 'ANTHROPIC_API_KEY',   type: 'anthropic',         defaultModel: 'claude-sonnet-4-6' },
    { name: 'openai',     envKey: 'OPENAI_API_KEY',      type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',      defaultModel: 'gpt-5.4' },
    { name: 'xai',        envKey: 'XAI_API_KEY',         type: 'openai-compatible', baseUrl: 'https://api.x.ai/v1',            defaultModel: 'grok-4' },
    { name: 'openrouter', envKey: 'OPENROUTER_API_KEY',  type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1',   defaultModel: 'anthropic/claude-opus-4-6' },
    { name: 'gemini',     envKey: 'GEMINI_API_KEY',      type: 'gemini',            defaultModel: 'gemini-2.5-flash' },
    { name: 'deepseek',   envKey: 'DEEPSEEK_API_KEY',    type: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1',    defaultModel: 'deepseek-chat' },
    { name: 'groq',       envKey: 'GROQ_API_KEY',        type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  ];

  for (const def of fallbackDefs) {
    if (providers[def.name]) continue; // Already registered as primary
    const key = process.env[def.envKey];
    if (!key) continue;

    const entry: ProviderEntry = {
      type: def.type,
      apiKey: key,
      model: def.defaultModel,
    };
    if (def.baseUrl) entry.baseUrl = def.baseUrl;
    if (def.name === 'openrouter') {
      entry.headers = { 'HTTP-Referer': 'https://bollaclaw.bolla.network' };
    }
    providers[def.name] = entry;
  }

  logger.info(`Built ${Object.keys(providers).length} providers from .env (primary: ${llmProvider})`);

  // Build fallback order: primary → all others
  const fallbackOrder = Object.keys(providers).filter(n => n !== llmProvider);

  return {
    default: llmProvider,
    router: providers.groq ? 'groq' : llmProvider,
    fallbackOrder,
    providers,
  };
}

/**
 * Get known base URL info for a service name
 */
export function getKnownBase(name: string) {
  return KNOWN_BASES[name] ?? null;
}
