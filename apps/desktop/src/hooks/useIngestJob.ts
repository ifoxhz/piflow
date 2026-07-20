import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityLogEntry, IngestJob } from '@bluelamp/core';
import {
  fetchIngestJob,
  formatLogEntry,
  startFolderImport,
  subscribeIngestJob,
} from '../api/ingest';

const MAX_LOG_LINES = 200;
const POLL_MS = 10_000;

export function useIngestJob(onComplete?: () => void) {
  const [job, setJob] = useState<IngestJob | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenFileIds = useRef(new Set<string>());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const appendLog = useCallback((entry: ActivityLogEntry) => {
    setActivityLog((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), entry]);
  }, []);

  const handleTerminalEvent = useCallback(
    (jobId: string, event: string, data: Record<string, unknown>) => {
      const fileId = String(data.fileId ?? '');
      if (fileId && seenFileIds.current.has(fileId)) return;
      if (fileId) seenFileIds.current.add(fileId);

      const entry = formatLogEntry(jobId, event, data);
      if (entry) appendLog(entry);
    },
    [appendLog],
  );

  const stopTracking = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const j = await fetchIngestJob(jobId);
        setJob(j);
        for (const f of j.files) {
          if (!f.completedAt) continue;
          if (seenFileIds.current.has(f.id)) continue;
          if (f.status === 'done') {
            seenFileIds.current.add(f.id);
            appendLog({
              id: crypto.randomUUID(),
              jobId,
              relativePath: f.relativePath,
              status: 'done',
              summary: `${f.chunkCount ?? 0} chunks indexed`,
              timestamp: f.completedAt,
            });
          } else if (f.status === 'skipped') {
            seenFileIds.current.add(f.id);
            appendLog({
              id: crypto.randomUUID(),
              jobId,
              relativePath: f.relativePath,
              status: 'skipped',
              summary: f.skipReason ?? 'skipped',
              timestamp: f.completedAt,
            });
          } else if (f.status === 'failed') {
            seenFileIds.current.add(f.id);
            appendLog({
              id: crypto.randomUUID(),
              jobId,
              relativePath: f.relativePath,
              status: 'failed',
              summary: f.error ?? 'failed',
              timestamp: f.completedAt,
            });
          }
        }
        if (['completed', 'failed', 'cancelled'].includes(j.status)) {
          setImporting(false);
          stopTracking();
          onComplete?.();
        }
      } catch {
        /* ignore poll errors */
      }
    },
    [appendLog, onComplete, stopTracking],
  );

  const startImport = useCallback(
    async (folderPath: string) => {
      setError(null);
      setActivityLog([]);
      seenFileIds.current.clear();
      stopTracking();

      try {
        setImporting(true);
        const res = await startFolderImport(folderPath);
        const jobId = res.jobId;

        if (res.limitNotice) {
          appendLog({
            id: crypto.randomUUID(),
            jobId,
            relativePath: '—',
            status: 'skipped',
            summary: res.limitNotice,
            timestamp: new Date().toISOString(),
          });
        }

        unsubRef.current = subscribeIngestJob(
          jobId,
          (event, data) => {
            if (event === 'job_progress' || event === 'heartbeat') return;
            if (event === 'job_done') {
              setImporting(false);
              stopTracking();
              onComplete?.();
              return;
            }
            if (event === 'file_started') {
              setJob((prev) =>
                prev
                  ? { ...prev, currentFileId: String(data.fileId) }
                  : prev,
              );
              return;
            }
            handleTerminalEvent(jobId, event, data);
          },
          () => {
            /* SSE failed — polling takes over */
          },
        );

        pollRef.current = setInterval(() => pollJob(jobId), POLL_MS);
        const initial = await fetchIngestJob(jobId);
        setJob(initial);
        await pollJob(jobId);
      } catch (e) {
        setImporting(false);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'Failed to fetch') {
          setError(
            'Cannot reach RAG server. Ensure pnpm dev:server is running, then refresh the page.',
          );
        } else {
          setError(msg);
        }
        stopTracking();
      }
    },
    [appendLog, handleTerminalEvent, onComplete, pollJob, stopTracking],
  );

  useEffect(() => () => stopTracking(), [stopTracking]);

  return { job, activityLog, importing, error, startImport };
}
