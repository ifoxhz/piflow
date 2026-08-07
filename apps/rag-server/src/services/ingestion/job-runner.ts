import { randomUUID } from 'node:crypto';
import type { IngestJob, IngestJobStats } from '@bluelamp/core';
import { emitJobEvent, clearJobListeners } from './events.js';
import { estimateIngestFile, estimateRemainingEmbed } from './estimate.js';
import { processFile } from './pipeline.js';

const activeJobs = new Map<string, IngestJob>();
let runningJobId: string | null = null;
/** When current file began embedding (for live ETA). */
const embedStartedAt = new Map<string, number>();

export function getActiveJobId(): string | null {
  return runningJobId;
}

export function getJob(jobId: string): IngestJob | undefined {
  return activeJobs.get(jobId);
}

export function registerJob(job: IngestJob): void {
  activeJobs.set(job.id, job);
}

function recomputeStats(job: IngestJob): IngestJobStats {
  const done = job.files.filter((f) => f.status === 'done').length;
  const failed = job.files.filter((f) => f.status === 'failed').length;
  const skipped = job.files.filter((f) => f.status === 'skipped').length;
  const pending = job.files.filter(
    (f) => !['done', 'failed', 'skipped'].includes(f.status),
  ).length;
  const chunksIndexed = job.files.reduce((s, f) => s + (f.chunkCount ?? 0), 0);
  return {
    total: job.files.length,
    pending,
    done,
    failed,
    skipped,
    chunksIndexed,
  };
}

export async function runJob(jobId: string): Promise<void> {
  const job = activeJobs.get(jobId);
  if (!job) return;

  runningJobId = jobId;
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  for (const file of job.files) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      break;
    }

    if (file.status === 'skipped' && file.skipReason) {
      file.completedAt = file.completedAt ?? new Date().toISOString();
      emitJobEvent(jobId, {
        event: 'file_skipped',
        data: { fileId: file.id, relativePath: file.relativePath, reason: file.skipReason },
      });
      job.stats = recomputeStats(job);
      continue;
    }

    if (file.status !== 'pending') continue;

    job.currentFileId = file.id;
    file.status = 'parsing';
    file.startedAt = new Date().toISOString();
    embedStartedAt.delete(file.id);

    const estimate = await estimateIngestFile(file.absolutePath, file.mimeType);
    file.estimatedPages = estimate.pages;
    file.estimatedChunks = estimate.estimatedChunks;
    file.etaLabel = estimate.label;
    console.log(
      `[ingest] estimate ${file.relativePath}: pages=${estimate.pages ?? '?'} ` +
        `chunks≈${estimate.estimatedChunks} eta=${estimate.label}`,
    );

    emitJobEvent(jobId, {
      event: 'file_started',
      data: {
        fileId: file.id,
        relativePath: file.relativePath,
        estimatedPages: estimate.pages,
        estimatedChunks: estimate.estimatedChunks,
        etaLabel: estimate.label,
      },
    });

    emitJobEvent(jobId, {
      event: 'job_progress',
      data: {
        done: job.stats.done + job.stats.failed + job.stats.skipped,
        total: job.stats.total,
        currentPath: file.relativePath,
      },
    });

    const result = await processFile(file, {
      onProgress: (progress) => {
        file.status =
          progress.status === 'parsing'
            ? 'parsing'
            : progress.status === 'indexing'
              ? 'indexing'
              : 'embedding';
        file.chunksDone = progress.chunksDone;
        file.chunksTotal = progress.chunksTotal;
        if (progress.pagesDone != null) file.pagesDone = progress.pagesDone;
        if (progress.pagesTotal != null) file.pagesTotal = progress.pagesTotal;
        if (progress.reusedPages != null) file.reusedPages = progress.reusedPages;
        if (!embedStartedAt.has(file.id) && progress.chunksDone > 0) {
          embedStartedAt.set(file.id, Date.now());
        }
        const remaining = estimateRemainingEmbed(
          progress.chunksDone,
          progress.chunksTotal,
          embedStartedAt.get(file.id),
        );
        file.etaLabel = remaining.label;
        const finishedChunks = job.files
          .filter((f) => f.id !== file.id && f.status === 'done')
          .reduce((s, f) => s + (f.chunkCount ?? 0), 0);
        job.stats = {
          ...recomputeStats(job),
          chunksIndexed: finishedChunks + progress.chunksDone,
        };
        emitJobEvent(jobId, {
          event: 'file_chunk_progress',
          data: {
            fileId: file.id,
            relativePath: file.relativePath,
            done: progress.chunksDone,
            total: progress.chunksTotal,
            pagesDone: progress.pagesDone,
            pagesTotal: progress.pagesTotal,
            reusedPages: progress.reusedPages,
            etaLabel: remaining.label,
          },
        });
      },
    });
    file.completedAt = new Date().toISOString();
    embedStartedAt.delete(file.id);

    if (result.status === 'done') {
      file.status = 'done';
      file.chunkCount = result.chunkCount;
      emitJobEvent(jobId, {
        event: 'file_done',
        data: {
          fileId: file.id,
          relativePath: file.relativePath,
          chunkCount: result.chunkCount ?? 0,
        },
      });
    } else if (result.status === 'skipped') {
      file.status = 'skipped';
      file.skipReason = result.skipReason;
      emitJobEvent(jobId, {
        event: 'file_skipped',
        data: {
          fileId: file.id,
          relativePath: file.relativePath,
          reason: result.skipReason ?? 'skipped',
        },
      });
    } else {
      file.status = 'failed';
      file.error = result.error;
      emitJobEvent(jobId, {
        event: 'file_failed',
        data: {
          fileId: file.id,
          relativePath: file.relativePath,
          error: result.error ?? 'unknown error',
        },
      });
    }

    job.stats = recomputeStats(job);
    job.currentFileId = undefined;
  }

  if (job.status === 'running') {
    job.status = job.stats.failed > 0 && job.stats.done === 0 ? 'failed' : 'completed';
  }

  job.finishedAt = new Date().toISOString();
  emitJobEvent(jobId, {
    event: 'job_done',
    data: { stats: job.stats, limitNotice: job.limitNotice },
  });

  runningJobId = null;
  setTimeout(() => clearJobListeners(jobId), 60_000);
}

export function createJob(rootPath: string, files: IngestJob['files'], limitNotice?: string): IngestJob {
  const stats = {
    total: files.length,
    pending: files.filter((f) => f.status === 'pending').length,
    done: 0,
    failed: 0,
    skipped: files.filter((f) => f.status === 'skipped').length,
    chunksIndexed: 0,
  };

  return {
    id: randomUUID(),
    rootPath,
    status: 'pending',
    createdAt: new Date().toISOString(),
    cancelRequested: false,
    stats,
    files,
    limitNotice,
  };
}

export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancelRequested = true;
  return true;
}
