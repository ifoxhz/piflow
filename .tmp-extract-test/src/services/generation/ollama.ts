import type { ScoredChunk } from '../retrieval/retriever.js';
import { logLlmQueryInput, summarizeChunksForLog } from '../chat/llm-query-log.js';
import { getOllamaRuntimeConfig } from './ollama-config.js';
import { isChineseQuery, isPleiasModelName } from './language.js';
import { buildPleiasPrompt, parsePleiasOutput } from './pleias-prompt.js';
import { buildRagInstructPrompt, type RagPromptOptions } from './rag-instruct-prompt.js';

const GENERATION_TIMEOUT_MS = Number(process.env.BLUELAMP_CHAT_TIMEOUT_MS ?? 180_000);

export function getOllamaUrl(): string {
  return getOllamaRuntimeConfig().url;
}

function getOllamaModel(): string {
  return getOllamaRuntimeConfig().model;
}

function getChineseOllamaModel(): string | undefined {
  const m = getOllamaRuntimeConfig().modelZh.trim();
  return m || undefined;
}

export function resolveOllamaModel(query: string): string {
  const zh = getChineseOllamaModel();
  if (isChineseQuery(query) && zh) return zh;
  return getOllamaModel();
}

export function isOllamaConfigured(): boolean {
  return Boolean(getOllamaRuntimeConfig().url);
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

export interface OllamaChatOptions {
  temperature?: number;
  topP?: number;
  numPredict?: number;
  timeoutMs?: number;
}

/** Shared chat completion (generation + retrieval planning). */
export async function ollamaChatComplete(
  model: string,
  userContent: string,
  options: OllamaChatOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('ollama timeout'), timeoutMs);

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
          temperature: options.temperature ?? 0.3,
          top_p: options.topP ?? 0.9,
          num_predict: options.numPredict ?? 1200,
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
  promptOptions?: RagPromptOptions,
): Promise<string> {
  const model = resolveOllamaModel(query);
  const endpoint = getOllamaUrl();

  if (isPleiasModelName(model)) {
    const prompt = buildPleiasPrompt(query, chunks, promptOptions);
    const raw = await ollamaGenerate(model, prompt, ['#END#', '<|answer_end|>']);
    const answer = parsePleiasOutput(raw);
    logLlmQueryInput({
      ts: new Date().toISOString(),
      stage: 'generation',
      backend: 'ollama',
      model,
      endpoint,
      userQuery: query,
      prompt,
      response: raw,
      retrieved: summarizeChunksForLog(chunks),
    });
    return answer;
  }

  const prompt = buildRagInstructPrompt(query, chunks, promptOptions);
  const answer = await ollamaChatComplete(model, prompt);
  logLlmQueryInput({
    ts: new Date().toISOString(),
    stage: 'generation',
    backend: 'ollama',
    model,
    endpoint,
    userQuery: query,
    prompt,
    response: answer,
    retrieved: summarizeChunksForLog(chunks),
  });
  return answer;
}

export async function checkOllamaHealth(): Promise<boolean> {
  const base = getOllamaUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
