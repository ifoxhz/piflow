import type {
  ActivityLogEntry,
  DocumentSummary,
  IngestFolderResponse,
  IngestJob,
} from '@bluelamp/core';
import { getRagServerUrl } from './rag';

export async function fetchDocuments(): Promise<{
  documents: DocumentSummary[];
  totalChunks: number;
}> {
  const res = await fetch(`${getRagServerUrl()}/documents`);
  if (!res.ok) throw new Error(`documents failed: ${res.status}`);
  return res.json();
}

export async function fetchDocumentStats(): Promise<{
  documentCount: number;
  chunkCount: number;
  lastImport: string | null;
}> {
  const res = await fetch(`${getRagServerUrl()}/documents/stats`);
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return res.json();
}

export async function startFolderImport(path: string): Promise<IngestFolderResponse> {
  const res = await fetch(`${getRagServerUrl()}/ingest/folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `import failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchIngestJob(jobId: string): Promise<IngestJob> {
  const res = await fetch(`${getRagServerUrl()}/ingest/jobs/${jobId}`);
  if (!res.ok) throw new Error(`job failed: ${res.status}`);
  return res.json();
}

export function formatLogEntry(
  jobId: string,
  event: string,
  data: Record<string, unknown>,
): ActivityLogEntry | null {
  const ts = new Date().toISOString();
  const rel = String(data.relativePath ?? '');

  if (event === 'file_done') {
    return {
      id: crypto.randomUUID(),
      jobId,
      relativePath: rel,
      status: 'done',
      summary: `${data.chunkCount} chunks indexed`,
      timestamp: ts,
    };
  }
  if (event === 'file_skipped') {
    return {
      id: crypto.randomUUID(),
      jobId,
      relativePath: rel,
      status: 'skipped',
      summary: String(data.reason ?? 'skipped'),
      timestamp: ts,
    };
  }
  if (event === 'file_failed') {
    return {
      id: crypto.randomUUID(),
      jobId,
      relativePath: rel,
      status: 'failed',
      summary: String(data.error ?? 'failed'),
      timestamp: ts,
    };
  }
  return null;
}

export function subscribeIngestJob(
  jobId: string,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onError?: () => void,
): () => void {
  const url = `${getRagServerUrl()}/ingest/jobs/${jobId}/stream`;
  const es = new EventSource(url);

  const handler = (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data as string) as Record<string, unknown>;
      onEvent(event.type || 'message', data);
    } catch {
      /* ignore */
    }
  };

  const events = [
    'file_started',
    'file_done',
    'file_skipped',
    'file_failed',
    'job_progress',
    'job_done',
    'heartbeat',
  ];
  for (const name of events) {
    es.addEventListener(name, handler as EventListener);
  }
  es.onerror = () => onError?.();

  return () => es.close();
}
