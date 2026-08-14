import type { ScoredChunk } from '../retrieval/retriever.js';
import { logLlmQueryInput, summarizeChunksForLog } from '../chat/llm-query-log.js';
import {
  getOllamaUrl,
  isOllamaConfigured,
  ollamaChatComplete,
  resolveOllamaModel,
  generateViaOllama,
} from './ollama.js';
import { buildRagInstructPrompt, type RagPromptOptions } from './rag-instruct-prompt.js';
import { getDeepseekRuntime, getLlmProvider } from '../piflow/llm-settings.js';

const GENERATION_TIMEOUT_MS = Number(process.env.PIFLOW_CHAT_TIMEOUT_MS ?? 180_000);

export type ActiveLlmBackend = 'ollama' | 'deepseek';

export type ActiveLlmTarget = {
  backend: ActiveLlmBackend;
  model: string;
  endpoint: string;
  configured: boolean;
};

export function resolveActiveLlm(queryForModelPick = ''): ActiveLlmTarget {
  const provider = getLlmProvider();
  if (provider === 'deepseek') {
    const ds = getDeepseekRuntime();
    return {
      backend: 'deepseek',
      model: ds.model,
      endpoint: ds.baseUrl,
      configured: Boolean(ds.apiKey),
    };
  }
  return {
    backend: 'ollama',
    model: resolveOllamaModel(queryForModelPick),
    endpoint: getOllamaUrl(),
    configured: isOllamaConfigured(),
  };
}

export function isActiveLlmConfigured(): boolean {
  return resolveActiveLlm().configured;
}

async function deepseekChatComplete(
  userContent: string,
  options: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const ds = getDeepseekRuntime();
  if (!ds.apiKey) {
    throw new Error('DeepSeek API Key is not configured');
  }

  const timeoutMs = options.timeoutMs ?? GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('deepseek timeout'), timeoutMs);

  try {
    const res = await fetch(`${ds.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ds.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: ds.model,
        messages: [{ role: 'user', content: userContent }],
        temperature: options.temperature ?? 0.3,
        top_p: options.topP ?? 0.9,
        max_tokens: options.maxTokens ?? 1200,
        // V4 defaults to thinking; keep tool/RAG latency predictable.
        thinking: { type: 'disabled' },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek ${res.status}: ${text || res.statusText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('DeepSeek returned empty content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Shared chat completion for retrieval planning + RAG generation. */
export async function activeLlmChatComplete(
  userContent: string,
  options: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    timeoutMs?: number;
    /** Used only when backend is Ollama (modelZh pick). */
    queryForModelPick?: string;
  } = {},
): Promise<{ text: string; backend: ActiveLlmBackend; model: string; endpoint: string }> {
  const target = resolveActiveLlm(options.queryForModelPick ?? '');
  if (!target.configured) {
    throw new Error(
      target.backend === 'deepseek'
        ? 'DeepSeek is selected but API Key is missing'
        : 'Ollama is selected but URL is not configured',
    );
  }

  if (target.backend === 'deepseek') {
    const text = await deepseekChatComplete(userContent, options);
    return {
      text,
      backend: 'deepseek',
      model: target.model,
      endpoint: target.endpoint,
    };
  }

  const text = await ollamaChatComplete(target.model, userContent, {
    temperature: options.temperature,
    topP: options.topP,
    numPredict: options.maxTokens,
    timeoutMs: options.timeoutMs,
  });
  return {
    text,
    backend: 'ollama',
    model: target.model,
    endpoint: target.endpoint,
  };
}

export async function generateViaActiveLlm(
  query: string,
  chunks: ScoredChunk[],
  promptOptions?: RagPromptOptions,
): Promise<string> {
  const target = resolveActiveLlm(query);
  if (target.backend === 'ollama') {
    return generateViaOllama(query, chunks, promptOptions);
  }

  const prompt = buildRagInstructPrompt(query, chunks, promptOptions);
  const answer = await deepseekChatComplete(prompt, {
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 1200,
  });
  logLlmQueryInput({
    ts: new Date().toISOString(),
    stage: 'generation',
    backend: 'deepseek',
    model: target.model,
    endpoint: target.endpoint,
    userQuery: query,
    prompt,
    response: answer,
    retrieved: summarizeChunksForLog(chunks),
  });
  return answer;
}
