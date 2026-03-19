import { ILlmProvider } from './ILlmProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider';
import { loadProvidersConfig, ProvidersConfig, ProviderEntry } from './ProviderConfig';
import { logger } from '../utils/logger';

/**
 * Dynamic ProviderFactory — creates providers from providers.json or .env
 *
 * Supports ANY provider:
 *  - Anthropic (Claude) → ClaudeProvider
 *  - Google (Gemini) → GeminiProvider
 *  - OpenAI, DeepSeek, Groq, OpenRouter, Together, xAI, Mistral, etc. → OpenAICompatibleProvider
 */
export class ProviderFactory {
  private static instances: Map<string, ILlmProvider> = new Map();
  private static config: ProvidersConfig | null = null;

  /**
   * Load or reload the providers configuration
   */
  static loadConfig(): ProvidersConfig {
    this.config = loadProvidersConfig();
    this.instances.clear(); // Reset instances on config reload
    return this.config;
  }

  /**
   * Get the current config (lazy-load if needed)
   */
  static getConfig(): ProvidersConfig {
    if (!this.config) this.loadConfig();
    return this.config!;
  }

  /**
   * Create (or get cached) a provider by name
   * If no name is given, uses the default provider from config
   */
  static create(providerName?: string): ILlmProvider {
    const cfg = this.getConfig();
    const name = providerName ?? cfg.default;

    // Return cached instance
    if (this.instances.has(name)) {
      return this.instances.get(name)!;
    }

    // Look up provider entry
    const entry = cfg.providers[name];
    if (!entry) {
      // Try to find a provider that matches the type (e.g., "claude" matches any anthropic type)
      const available = Object.keys(cfg.providers).join(', ');
      throw new Error(`Provider "${name}" not found. Available: ${available}`);
    }

    if (!entry.apiKey) {
      throw new Error(`Provider "${name}" has no API key configured`);
    }

    const provider = this.createFromEntry(name, entry);
    this.instances.set(name, provider);

    logger.info(`Provider initialized: ${name} (${entry.type}, model: ${entry.model})`);
    return provider;
  }

  /**
   * Create a provider instance from a ProviderEntry
   */
  private static createFromEntry(name: string, entry: ProviderEntry): ILlmProvider {
    switch (entry.type) {
      case 'anthropic':
        return new ClaudeProvider(name, entry);

      case 'gemini':
        return new GeminiProvider(name, entry);

      case 'openai-compatible':
        return new OpenAICompatibleProvider(name, entry);

      default:
        throw new Error(`Unknown provider type: ${entry.type}. Use: anthropic, gemini, or openai-compatible`);
    }
  }

  /**
   * Get the configured router provider (for skill routing — cheap/fast)
   */
  static createRouter(): ILlmProvider {
    const cfg = this.getConfig();
    const routerName = cfg.router;
    if (routerName && cfg.providers[routerName]) {
      return this.create(routerName);
    }
    // Fallback: use default provider
    return this.create();
  }

  /**
   * Try primary provider, walk through fallback chain on failure
   */
  static async withFallback<T>(
    fn: (provider: ILlmProvider) => Promise<T>,
    primaryName?: string
  ): Promise<T> {
    const cfg = this.getConfig();
    const primary = primaryName ?? cfg.default;

    // Build fallback chain: primary → fallbackOrder → all remaining providers
    const chain = [primary];
    if (cfg.fallbackOrder) {
      for (const name of cfg.fallbackOrder) {
        if (!chain.includes(name)) chain.push(name);
      }
    }
    // Add any remaining configured providers
    for (const name of Object.keys(cfg.providers)) {
      if (!chain.includes(name)) chain.push(name);
    }

    let lastError: unknown;
    for (const name of chain) {
      try {
        const provider = this.create(name);
        return await fn(provider);
      } catch (err) {
        lastError = err;
        logger.warn(`Provider ${name} failed: ${err}. Trying next...`);
      }
    }

    throw lastError ?? new Error('All providers failed');
  }

  /**
   * List all configured provider names and their types
   */
  static listProviders(): Array<{ name: string; type: string; model: string }> {
    const cfg = this.getConfig();
    return Object.entries(cfg.providers).map(([name, entry]) => ({
      name,
      type: entry.type,
      model: entry.model,
    }));
  }

  /**
   * Get the default provider name
   */
  static getDefaultName(): string {
    return this.getConfig().default;
  }
}
