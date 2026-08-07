import { getPiOllamaBaseUrl, getPiOllamaSettings } from './ollama-bridge.js';
import { getDeepseekRuntime, getLlmProvider, type LlmProvider } from './llm-settings.js';

export type PiLlmProvider = LlmProvider;

export type PiLlmSettings = {
  provider: PiLlmProvider;
  /** Provider id used in Pi models.json */
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  configured: boolean;
  /** Human label for logs / errors */
  label: string;
};

/** Resolve piFlow LLM backend from Settings (llm-config.json); Ollama via ollama-config. */
export function getPiLlmSettings(): PiLlmSettings {
  const provider = getLlmProvider();

  if (provider === 'deepseek') {
    const ds = getDeepseekRuntime();
    return {
      provider: 'deepseek',
      providerId: 'deepseek',
      model: ds.model,
      baseUrl: ds.baseUrl,
      apiKey: ds.apiKey,
      configured: Boolean(ds.apiKey),
      label: `deepseek/${ds.model}`,
    };
  }

  const ollama = getPiOllamaSettings();
  return {
    provider: 'ollama',
    providerId: 'ollama',
    model: ollama.model,
    baseUrl: getPiOllamaBaseUrl(),
    apiKey: 'ollama',
    configured: ollama.configured,
    label: `ollama/${ollama.model}`,
  };
}
