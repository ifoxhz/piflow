import type { ChatHistoryMessage, ChatResult } from '@bluelamp/core';

/** Dev: Vite proxies /api → rag-server (avoids CORS + WSL port issues). */
const RAG_SERVER_URL =
  import.meta.env.VITE_RAG_SERVER_URL ??
  (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3847');

/** Client wait budget; keep under Vite proxy (300s) so we surface a clear timeout. */
export const CHAT_REQUEST_TIMEOUT_MS = 290_000;

export class ChatTimeoutError extends Error {
  constructor(timeoutMs = CHAT_REQUEST_TIMEOUT_MS) {
    const seconds = Math.round(timeoutMs / 1000);
    super(`请求超时（已等待约 ${seconds} 秒）。请稍后重试，或检查本地模型是否卡住。`);
    this.name = 'ChatTimeoutError';
  }
}

export function getRagServerUrl(): string {
  return RAG_SERVER_URL;
}

export async function fetchHealth() {
  const res = await fetch(`${RAG_SERVER_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

export interface SendChatOptions {
  history?: ChatHistoryMessage[];
  /** Default true. When false: skip LLM retrieval planning. */
  useRetrievalPlan?: boolean;
  /** Abort after this many ms. Default CHAT_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function sendChatMessage(
  message: string,
  historyOrOptions?: ChatHistoryMessage[] | SendChatOptions,
): Promise<ChatResult> {
  const options: SendChatOptions = Array.isArray(historyOrOptions)
    ? { history: historyOrOptions }
    : historyOrOptions ?? {};
  const useRetrievalPlan = options.useRetrievalPlan !== false;
  const timeoutMs = options.timeoutMs ?? CHAT_REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new ChatTimeoutError(timeoutMs));
  }, timeoutMs);

  try {
    const res = await fetch(`${RAG_SERVER_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: options.history?.length ? options.history : undefined,
        useRetrievalPlan,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Chat failed: ${res.status}`);
    }
    return res.json() as Promise<ChatResult>;
  } catch (err) {
    if (err instanceof ChatTimeoutError) throw err;
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof ChatTimeoutError) throw reason;
      if (reason instanceof Error) throw reason;
      throw new ChatTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
