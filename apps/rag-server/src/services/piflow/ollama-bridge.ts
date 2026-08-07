import { getOllamaRuntimeConfig } from '../generation/ollama-config.js';

/** Strip trailing slash and optional /v1 for display / Ollama native API. */
export function toDisplayOllamaUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '').replace(/\/v1$/i, '');
}

/** Ensure OpenAI-compatible /v1 base URL for Pi ModelRuntime. */
export function toPiOllamaBaseUrl(raw: string): string {
  const display = toDisplayOllamaUrl(raw);
  return `${display}/v1`;
}

export function getPiOllamaSettings(): { url: string; model: string; configured: boolean } {
  const cfg = getOllamaRuntimeConfig();
  const url = toDisplayOllamaUrl(cfg.url);
  return {
    url,
    model: cfg.model,
    configured: Boolean(url),
  };
}

export function getPiOllamaBaseUrl(): string {
  return toPiOllamaBaseUrl(getPiOllamaSettings().url);
}
