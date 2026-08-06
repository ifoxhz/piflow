import type { IngestSseEvent } from '@bluelamp/core';

type Listener = (evt: IngestSseEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeJob(jobId: string, listener: Listener): () => void {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId)!.add(listener);
  return () => listeners.get(jobId)?.delete(listener);
}

export function emitJobEvent(jobId: string, evt: IngestSseEvent): void {
  for (const fn of listeners.get(jobId) ?? []) {
    try {
      fn(evt);
    } catch (err) {
      // A broken SSE client must not abort the ingest loop.
      console.warn('[ingest] job listener failed', jobId, err);
    }
  }
}

export function clearJobListeners(jobId: string): void {
  listeners.delete(jobId);
}
