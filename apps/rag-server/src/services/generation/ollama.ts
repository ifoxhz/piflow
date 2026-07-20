import type { ScoredChunk } from '../retrieval/retriever.js';
import { isChineseQuery, isPleiasModelName } from './language.js';
import { buildPleiasPrompt, parsePleiasOutput } from './pleias-prompt.js';
import { buildRagInstructPrompt } from './rag-instruct-prompt.js';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const GENERATION_TIMEOUT_MS = Number(process.env.BLUELAMP_CHAT_TIMEOUT_MS ?? 180_000);

function getOllamaUrl(): string {
  return (process.env.BLUELAMP_OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '');
}

function getOllamaModel(): string {
  return process.env.BLUELAMP_OLLAMA_MODEL ?? 'qwen3.5:4b';
}

function getChineseOllamaModel(): string | undefined {
  const m = process.env.BLUELAMP_OLLAMA_MODEL_ZH?.trim();
  return m || undefined;
}

function resolveModel(query: string): string {
  const zh = getChineseOllamaModel();
  if (isChineseQuery(query) && zh) return zh;
  return getOllamaModel();
}

export function isOllamaConfigured(): boolean {
  return Boolean(process.env.BLUELAMP_OLLAMA_URL?.trim());
}

async function ollamaGenerate(
  model: string,
  prompt: string,
  stops: string[] = [],
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('ollama timeout'), GENERATION_TIMEOUT_MS);

  try {
    const res = await fetch(`${getOllamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0,
          top_p: 0.95,
          num_predict: 800,
          stop: stops.length > 0 ? stops : undefined,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text || res.statusText}`);
    }

    const data = (await res.json()) as { response?: string };
    if (!data.response?.trim()) {
      throw new Error('Ollama returned empty response');
    }

    return data.response.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Qwen 3.5 等 thinking 模型需走 chat API 并关闭 think，否则 response 为空 */
async function ollamaChat(model: string, userContent: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('ollama timeout'), GENERATION_TIMEOUT_MS);

  try {
    const res = await fetch(`${getOllamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userContent }],
        stream: false,
        think: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 1200,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text || res.statusText}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string; thinking?: string };
    };
    const content = data.message?.content?.trim();
    if (content) return content;

    const thinking = data.message?.thinking?.trim();
    if (thinking) {
      console.warn('[ollama] empty content, falling back to thinking excerpt');
      return thinking.slice(-800);
    }

    throw new Error('Ollama chat returned empty content');
  } finally {
    clearTimeout(timer);
  }
}

/** 统一入口：Pleias 走 generate；Qwen 等走 chat */
export async function generateViaOllama(
  query: string,
  chunks: ScoredChunk[],
): Promise<string> {
  const model = resolveModel(query);

  if (isPleiasModelName(model)) {
    const prompt = buildPleiasPrompt(query, chunks);
    const raw = await ollamaGenerate(model, prompt, ['#END#', '<|answer_end|>']);
    return parsePleiasOutput(raw);
  }

  const prompt = buildRagInstructPrompt(query, chunks);
  return ollamaChat(model, prompt);
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
