import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from '../../platform/paths.js';
import {
  getOllamaRuntimeConfig,
  updateOllamaConfig,
  type OllamaRuntimeConfig,
} from '../generation/ollama-config.js';
import { checkOllamaHealth } from '../generation/ollama.js';

export type LlmProvider = 'ollama' | 'deepseek';

export type DeepseekStoredConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

type StoredLlmConfig = {
  provider: LlmProvider;
  deepseek: DeepseekStoredConfig;
};

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com/v1';

function configPath(): string {
  return path.join(getDataDir(), 'llm-config.json');
}

function normalizeBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/$/, '') || DEFAULT_DEEPSEEK_BASE;
  if (!/\/v1$/i.test(base)) {
    base = `${base}/v1`;
  }
  return base;
}

function defaultDeepseek(): DeepseekStoredConfig {
  return {
    apiKey: '',
    model: DEFAULT_DEEPSEEK_MODEL,
    baseUrl: DEFAULT_DEEPSEEK_BASE,
  };
}

function defaultStored(): StoredLlmConfig {
  return {
    provider: 'ollama',
    deepseek: defaultDeepseek(),
  };
}

let stored: StoredLlmConfig = defaultStored();
let loaded = false;

function parseStored(raw: unknown): StoredLlmConfig {
  const base = defaultStored();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const provider = obj.provider === 'deepseek' ? 'deepseek' : 'ollama';
  const ds =
    obj.deepseek && typeof obj.deepseek === 'object'
      ? (obj.deepseek as Record<string, unknown>)
      : {};
  return {
    provider,
    deepseek: {
      apiKey: typeof ds.apiKey === 'string' ? ds.apiKey.trim() : '',
      model:
        (typeof ds.model === 'string' && ds.model.trim()) || DEFAULT_DEEPSEEK_MODEL,
      baseUrl: normalizeBaseUrl(
        typeof ds.baseUrl === 'string' ? ds.baseUrl : DEFAULT_DEEPSEEK_BASE,
      ),
    },
  };
}

/** Disk overlay for provider + DeepSeek. Ollama stays in ollama-config.json. */
export async function loadLlmConfig(): Promise<void> {
  stored = defaultStored();
  try {
    const raw = await readFile(configPath(), 'utf8');
    stored = parseStored(JSON.parse(raw));
  } catch {
    /* no saved llm-config yet — default ollama; never seed apiKey from .env into disk */
  }
  loaded = true;
}

function ensureLoaded(): void {
  if (!loaded) {
    // Sync path before await load (tests / early calls): keep defaults.
    stored = defaultStored();
  }
}

export function getLlmProvider(): LlmProvider {
  ensureLoaded();
  return stored.provider;
}

/** Runtime DeepSeek credentials. Disk first; env only as silent fallback (never for UI). */
export function getDeepseekRuntime(): {
  apiKey: string;
  model: string;
  baseUrl: string;
  apiKeyFromDisk: boolean;
  apiKeyFromEnv: boolean;
} {
  ensureLoaded();
  const diskKey = stored.deepseek.apiKey.trim();
  const envKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  const apiKey = diskKey || envKey;
  return {
    apiKey,
    model: stored.deepseek.model || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: normalizeBaseUrl(stored.deepseek.baseUrl || DEFAULT_DEEPSEEK_BASE),
    apiKeyFromDisk: Boolean(diskKey),
    apiKeyFromEnv: !diskKey && Boolean(envKey),
  };
}

export type LlmConfigPublic = {
  provider: LlmProvider;
  ollama: OllamaRuntimeConfig & {
    configured: boolean;
    reachable: boolean;
  };
  deepseek: {
    /** Always empty in API responses — never echo secrets into the form. */
    apiKey: '';
    model: string;
    baseUrl: string;
    apiKeySet: boolean;
    configured: boolean;
  };
};

export async function getLlmConfigPublic(): Promise<LlmConfigPublic> {
  ensureLoaded();
  const ollama = getOllamaRuntimeConfig();
  const reachable = ollama.url ? await checkOllamaHealth() : false;
  const ds = getDeepseekRuntime();
  const apiKeySet = ds.apiKeyFromDisk || ds.apiKeyFromEnv;
  return {
    provider: stored.provider,
    ollama: {
      ...ollama,
      configured: Boolean(ollama.url),
      reachable,
    },
    deepseek: {
      apiKey: '',
      model: ds.model,
      baseUrl: ds.baseUrl,
      apiKeySet,
      configured: Boolean(apiKeySet),
    },
  };
}

export type LlmConfigUpdate = {
  provider?: LlmProvider;
  ollama?: Partial<OllamaRuntimeConfig>;
  deepseek?: {
    /** Empty / omit = keep existing disk key (never auto-fill from .env). */
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
};

export async function updateLlmConfig(input: LlmConfigUpdate): Promise<LlmConfigPublic> {
  ensureLoaded();

  if (input.provider === 'ollama' || input.provider === 'deepseek') {
    stored.provider = input.provider;
  }

  if (input.deepseek) {
    const nextKey = input.deepseek.apiKey?.trim() ?? '';
    if (nextKey) {
      stored.deepseek.apiKey = nextKey;
    }
    // Explicit empty string after user cleared? Only replace if they send a non-empty key.
    // To clear key: send apiKey with special — skip for now; leave as keep-on-empty.
    if (typeof input.deepseek.model === 'string' && input.deepseek.model.trim()) {
      stored.deepseek.model = input.deepseek.model.trim();
    }
    if (typeof input.deepseek.baseUrl === 'string' && input.deepseek.baseUrl.trim()) {
      stored.deepseek.baseUrl = normalizeBaseUrl(input.deepseek.baseUrl);
    }
  }

  if (input.ollama) {
    await updateOllamaConfig(input.ollama);
  }

  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  const toDisk: StoredLlmConfig = {
    provider: stored.provider,
    deepseek: { ...stored.deepseek },
  };
  await writeFile(configPath(), `${JSON.stringify(toDisk, null, 2)}\n`, 'utf8');
  loaded = true;

  console.log(
    `[rag-server] LLM provider → ${stored.provider}` +
      (stored.provider === 'deepseek'
        ? ` (model=${stored.deepseek.model}, apiKey=${stored.deepseek.apiKey ? 'set' : 'missing'})`
        : ''),
  );

  return getLlmConfigPublic();
}
