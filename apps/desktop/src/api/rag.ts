import type { ChatHistoryMessage, ChatResult } from '@bluelamp/core';

/** Dev: Vite proxies /api → rag-server (avoids CORS + WSL port issues). */
const RAG_SERVER_URL =
  import.meta.env.VITE_RAG_SERVER_URL ??
  (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3847');

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
}

export async function sendChatMessage(
  message: string,
  historyOrOptions?: ChatHistoryMessage[] | SendChatOptions,
): Promise<ChatResult> {
  const options: SendChatOptions = Array.isArray(historyOrOptions)
    ? { history: historyOrOptions }
    : historyOrOptions ?? {};
  const useRetrievalPlan = options.useRetrievalPlan !== false;

  const res = await fetch(`${RAG_SERVER_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history: options.history?.length ? options.history : undefined,
      useRetrievalPlan,
    }),
  });
  if (!res.ok) {
    throw new Error(`Chat failed: ${res.status}`);
  }
  return res.json() as Promise<ChatResult>;
}
