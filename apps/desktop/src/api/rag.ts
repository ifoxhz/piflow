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

export async function sendChatMessage(message: string) {
  const res = await fetch(`${RAG_SERVER_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Chat failed: ${res.status}`);
  }
  return res.json() as Promise<{ reply: string; citations: import('@bluelamp/core').Citation[] }>;
}
