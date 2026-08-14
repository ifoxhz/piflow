import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../../platform/paths.js';

export interface OllamaRuntimeConfig {
  /** Empty string means Ollama generation is disabled. */
  url: string;
  model: string;
  /** Optional Chinese-specific model; empty = use `model`. */
  modelZh: string;
}

const DEFAULT_MODEL = 'qwen3.5:4b';

function configPath(): string {
  return path.join(getDataDir(), 'ollama-config.json');
}

function fromEnv(): OllamaRuntimeConfig {
  return {
    url: (process.env.PIFLOW_OLLAMA_URL ?? '').trim().replace(/\/$/, ''),
    model: (process.env.PIFLOW_OLLAMA_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    modelZh: (process.env.PIFLOW_OLLAMA_MODEL_ZH ?? '').trim(),
  };
}

let runtime: OllamaRuntimeConfig = fromEnv();

function syncEnv(next: OllamaRuntimeConfig): void {
  if (next.url) {
    process.env.PIFLOW_OLLAMA_URL = next.url;
  } else {
    delete process.env.PIFLOW_OLLAMA_URL;
  }
  process.env.PIFLOW_OLLAMA_MODEL = next.model;
  if (next.modelZh) {
    process.env.PIFLOW_OLLAMA_MODEL_ZH = next.modelZh;
  } else {
    delete process.env.PIFLOW_OLLAMA_MODEL_ZH;
  }
}

function normalize(input: Partial<OllamaRuntimeConfig>): OllamaRuntimeConfig {
  const url = (input.url ?? runtime.url).trim().replace(/\/$/, '');
  const model = (input.model ?? runtime.model).trim() || DEFAULT_MODEL;
  const modelZh = (input.modelZh ?? runtime.modelZh).trim();
  return { url, model, modelZh };
}

export function getOllamaRuntimeConfig(): OllamaRuntimeConfig {
  return { ...runtime };
}

/** Disk overlay (if present) wins over process env; call once at startup. */
export async function loadOllamaConfig(): Promise<OllamaRuntimeConfig> {
  runtime = fromEnv();
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OllamaRuntimeConfig>;
    runtime = normalize({
      url: typeof parsed.url === 'string' ? parsed.url : runtime.url,
      model: typeof parsed.model === 'string' ? parsed.model : runtime.model,
      modelZh: typeof parsed.modelZh === 'string' ? parsed.modelZh : runtime.modelZh,
    });
  } catch {
    /* no saved config yet */
  }
  syncEnv(runtime);
  return getOllamaRuntimeConfig();
}

export async function updateOllamaConfig(
  input: Partial<OllamaRuntimeConfig>,
): Promise<OllamaRuntimeConfig> {
  runtime = normalize(input);
  syncEnv(runtime);

  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');

  console.log(
    runtime.url
      ? `[rag-server] Ollama config updated → ${runtime.url} (model=${runtime.model})`
      : '[rag-server] Ollama config cleared (generation via Ollama disabled)',
  );

  return getOllamaRuntimeConfig();
}
