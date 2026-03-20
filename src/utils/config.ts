import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Config is lazy-loaded via getter to avoid crashing during onboard
 * (when .env doesn't exist yet). The config object is only built
 * the first time it's accessed.
 */
let _config: ReturnType<typeof buildConfig> | null = null;

function buildConfig() {
  // Re-load .env in case it was just created by the onboard wizard
  dotenv.config();

  return {
    telegram: {
      botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
      allowedUserIds: optionalEnv('TELEGRAM_ALLOWED_USER_IDS', '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    },
    llm: {
      provider: optionalEnv('LLM_PROVIDER', 'claude'),
      routerProvider: optionalEnv('ROUTER_PROVIDER', 'groq'),
      anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
      geminiApiKey: optionalEnv('GEMINI_API_KEY', ''),
      deepseekApiKey: optionalEnv('DEEPSEEK_API_KEY', ''),
      groqApiKey: optionalEnv('GROQ_API_KEY', ''),
      openaiApiKey: optionalEnv('OPENAI_API_KEY', ''),
      openrouterApiKey: optionalEnv('OPENROUTER_API_KEY', ''),
      xaiApiKey: optionalEnv('XAI_API_KEY', ''),
    },
    agent: {
      maxIterations: parseInt(optionalEnv('MAX_ITERATIONS', '5'), 10),
      memoryWindowSize: parseInt(optionalEnv('MEMORY_WINDOW_SIZE', '20'), 10),
      skillsDir: path.resolve(optionalEnv('SKILLS_DIR', '.agents/skills')),
    },
    audio: {
      sttProvider: optionalEnv('STT_PROVIDER', 'groq_whisper') as 'groq_whisper' | 'local_whisper',
      ttsVoice: optionalEnv('TTS_VOICE', 'pt-BR-ThalitaMultilingualNeural'),
      autoAudioReply: optionalEnv('AUTO_AUDIO_REPLY', 'true') === 'true',
    },
    memory: {
      pgConnectionString: optionalEnv('PG_CONNECTION_STRING', ''),
      maxContextTokens: parseInt(optionalEnv('MAX_CONTEXT_TOKENS', '50000'), 10),
      systemReserve: parseInt(optionalEnv('SYSTEM_TOKEN_RESERVE', '4000'), 10),
    },
    admin: {
      enabled: optionalEnv('ADMIN_ENABLED', 'true') === 'true',
      port: parseInt(optionalEnv('ADMIN_PORT', '21086'), 10),
      password: optionalEnv('ADMIN_PASSWORD', 'bollaclaw'),
      host: optionalEnv('ADMIN_HOST', '127.0.0.1'),
    },
    paths: {
      data: path.resolve(optionalEnv('DATA_DIR', './data')),
      tmp: path.resolve(optionalEnv('TMP_DIR', './tmp')),
      logs: path.resolve(optionalEnv('LOGS_DIR', './logs')),
    },
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
  };
}

// Proxy that lazy-loads config on first property access
export const config: ReturnType<typeof buildConfig> = new Proxy({} as any, {
  get(_target, prop) {
    if (!_config) {
      _config = buildConfig();
    }
    return (_config as any)[prop];
  },
});
