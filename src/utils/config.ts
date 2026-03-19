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

export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: requireEnv('TELEGRAM_ALLOWED_USER_IDS')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  },
  // Legacy LLM config — still used as fallback if providers.json doesn't exist
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
  admin: {
    enabled: optionalEnv('ADMIN_ENABLED', 'true') === 'true',
    port: parseInt(optionalEnv('ADMIN_PORT', '3000'), 10),
    password: optionalEnv('ADMIN_PASSWORD', 'bollaclaw'),
    host: optionalEnv('ADMIN_HOST', '0.0.0.0'),
  },
  paths: {
    data: path.resolve(optionalEnv('DATA_DIR', './data')),
    tmp: path.resolve(optionalEnv('TMP_DIR', './tmp')),
    logs: path.resolve(optionalEnv('LOGS_DIR', './logs')),
  },
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
};
