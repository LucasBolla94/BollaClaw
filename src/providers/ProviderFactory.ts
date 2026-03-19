import { ILlmProvider } from './ILlmProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { GroqProvider } from './GroqProvider';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

type ProviderName = 'claude' | 'gemini' | 'deepseek' | 'groq';

export class ProviderFactory {
  private static instances: Map<ProviderName, ILlmProvider> = new Map();

  static create(providerName?: ProviderName): ILlmProvider {
    const name = providerName ?? config.llm.provider;

    if (this.instances.has(name)) {
      return this.instances.get(name)!;
    }

    let provider: ILlmProvider;

    switch (name) {
      case 'claude':
        if (!config.llm.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not set');
        provider = new ClaudeProvider(config.llm.anthropicApiKey);
        break;

      case 'gemini':
        if (!config.llm.geminiApiKey) throw new Error('GEMINI_API_KEY not set');
        provider = new GeminiProvider(config.llm.geminiApiKey);
        break;

      case 'deepseek':
        if (!config.llm.deepseekApiKey) throw new Error('DEEPSEEK_API_KEY not set');
        provider = new DeepSeekProvider(config.llm.deepseekApiKey);
        break;

      case 'groq':
        if (!config.llm.groqApiKey) throw new Error('GROQ_API_KEY not set');
        provider = new GroqProvider(config.llm.groqApiKey);
        break;

      default:
        throw new Error(`Unknown provider: ${name}`);
    }

    this.instances.set(name, provider);
    logger.info(`LLM Provider initialized: ${name}`);
    return provider;
  }

  /** Try primary provider, fall back to another if it fails */
  static async withFallback<T>(
    primary: ProviderName,
    fallback: ProviderName,
    fn: (provider: ILlmProvider) => Promise<T>
  ): Promise<T> {
    try {
      return await fn(this.create(primary));
    } catch (err) {
      logger.warn(`Provider ${primary} failed, trying fallback ${fallback}: ${err}`);
      return await fn(this.create(fallback));
    }
  }
}
