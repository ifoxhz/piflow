import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityLogEntry, IngestFileTask, IngestJob } from '@bluelamp/core';
import {
  fetchIngestJob,
  formatLogEntry,
  startFolderImport,
  subscribeIngestJob,
} from '../api/ingest';

const MAX_LOG_LINES = 200;
const POLL_MS = 5_000;

function patchFile(
  files: IngestFileTask[],
  fileId: string,
  patch: Partial<IngestFileTask>,
): IngestFileTask[] {
  return files.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
}

function recomputeClientStats(files: IngestFileTask[], prev: IngestJob['stats']): IngestJob['stats'] {
  const done = files.filter((f) => f.status === 'done').length;
  const failed = files.filter((f) => f.status === 'failed').length;
  const skipped = files.filter((f) => f.status === 'skipped').length;
  const pending = files.filter(
    (f) => !['done', 'failed', 'skipped'].includes(f.status),
  ).length;
  const chunksIndexed = files.reduce((s, f) => s + (f.chunkCount ?? 0), 0);
  return {
    total: prev.total || files.length,
    pending,
    done,
    failed,
    skipped,
    chunksIndexed,
  };
}

export function useIngestJob(onComplete?: () => void) {
  const [job, setJob] = useState<IngestJob | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenFileIds = useRef(new Set<string>());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const completedRef = useRef(false);

  const appendLog = useCallback((entry: ActivityLogEntry) => {
    setActivityLog((prev) => [...prev.slice(-(MAX_LOG_LINES - 1)), entry]);
  }, []);

  const finishImport = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setImporting(false);
    unsubRef.current?.();
    unsubRef.current = null;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    onComplete?.();
  }, [onComplete]);

  const handleTerminalEvent = useCallback(
    (jobId: string, event: string, data: Record<string, unknown>) => {
      const fileId = String(data.fileId ?? '');
      if (fileId && seenFileIds.current.has(fileId)) return;
      if (fileId) seenFileIds.current.add(fileId);

      const entry = formatLogEntry(jobId, event, data);
      if (entry) {
        setActivityLog((prev) => {
          const withoutRunning = prev.filter(
            (e) => !(e.status === 'running' && e.relativePath === entry.relativePath),
          );
          return [...withoutRunning.slice(-(MAX_LOG_LINES - 1)), entry];
        });
      }

      if (!fileId) return;

      setJob((prev) => {
        if (!prev || prev.id !== jobId) return prev;
        let files = prev.files;
        if (event === 'file_done') {
          files = patchFile(files, fileId, {
            status: 'done',
            chunkCount: Number(data.chunkCount ?? 0),
            completedAt: new Date().toISOString(),
          });
        } else if (event === 'file_skipped') {
          files = patchFile(files, fileId, {
            status: 'skipped',
            skipReason: String(data.reason ?? 'skipped'),
            completedAt: new Date().toISOString(),
          });
        } else if (event === 'file_failed') {
          files = patchFile(files, fileId, {
            status: 'failed',
            error: String(data.error ?? 'failed'),
            completedAt: new Date().toISOString(),
          });
        } else {
          return prev;
        }
        return {
          ...prev,
          currentFileId: undefined,
          files,
          stats: recomputeClientStats(files, prev.stats),
        };
      });
    },
    [],
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
          finishImport();
        }
      } catch {
        /* ignore poll errors */
      }
    },
    [appendLog, finishImport],
  );

  const startImport = useCallback(
    async (folderPath: string) => {
      setError(null);
      setActivityLog([]);
      seenFileIds.current.clear();
      completedRef.current = false;
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
            if (event === 'heartbeat') return;
            if (event === 'job_done') {
              void pollJob(jobId).finally(() => finishImport());
              return;
            }
            if (event === 'job_progress') {
              return;
            }
            if (event === 'file_started') {
              const fileId = String(data.fileId ?? '');
              const relativePath = String(data.relativePath ?? '');
              setJob((prev) => {
                if (!prev || prev.id !== jobId) return prev;
                const files = fileId
                  ? patchFile(prev.files, fileId, { status: 'parsing' })
                  : prev.files;
                return { ...prev, currentFileId: fileId || prev.currentFileId, files };
              });
              if (relativePath) {
                setActivityLog((prev) => {
                  const withoutOldRunning = prev.filter((e) => e.status !== 'running');
                  return [
                    ...withoutOldRunning.slice(-(MAX_LOG_LINES - 1)),
                    {
                      id: crypto.randomUUID(),
                      jobId,
                      relativePath,
                      status: 'running' as const,
                      summary: 'processing…',
                      timestamp: new Date().toISOString(),
                    },
                  ];
                });
              }
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
    [appendLog, finishImport, handleTerminalEvent, pollJob, stopTracking],
  );

  useEffect(() => () => stopTracking(), [stopTracking]);

  return { job, activityLog, importing, error, startImport };
}
