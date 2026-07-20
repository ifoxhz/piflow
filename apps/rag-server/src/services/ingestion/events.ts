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
    fn(evt);
  }
}

export function clearJobListeners(jobId: string): void {
  listeners.delete(jobId);
}
