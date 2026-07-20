import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { stat } from 'node:fs/promises';
import {
  cancelJob,
  createJob,
  getActiveJobId,
  getJob,
  registerJob,
  runJob,
} from '../services/ingestion/job-runner.js';
import { walkFolder } from '../services/ingestion/folder-walker.js';
import { subscribeJob } from '../services/ingestion/events.js';
import { normalizeImportPath } from '../platform/paths.js';

export const ingestRoutes = new Hono();

ingestRoutes.post('/folder', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  const rawPath = body.path?.trim();
  if (!rawPath) {
    return c.json({ error: 'path is required' }, 400);
  }

  if (getActiveJobId()) {
    return c.json({ error: 'another import job is already running' }, 409);
  }

  const folderPath = normalizeImportPath(rawPath);

  try {
    const st = await stat(folderPath);
    if (!st.isDirectory()) {
      return c.json({ error: 'path is not a directory' }, 400);
    }
  } catch {
    return c.json({ error: 'directory not found or not accessible' }, 400);
  }

  const { files, limitNotice } = await walkFolder(folderPath);
  const job = createJob(folderPath, files, limitNotice);
  registerJob(job);

  runJob(job.id).catch((err) => {
    console.error('[ingest] job failed', err);
    const j = getJob(job.id);
    if (j) {
      j.status = 'failed';
      j.finishedAt = new Date().toISOString();
    }
  });

  return c.json(
    {
      jobId: job.id,
      rootPath: job.rootPath,
      status: job.status,
      totalFiles: job.stats.total,
      limitNotice,
    },
    202,
  );
});

ingestRoutes.get('/jobs/active', (c) => {
  const id = getActiveJobId();
  if (!id) return c.json({ active: false });
  const job = getJob(id);
  return c.json({ active: true, jobId: id, job });
});

ingestRoutes.get('/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({ error: 'job not found' }, 404);
  return c.json(job);
});

ingestRoutes.post('/jobs/:id/cancel', (c) => {
  const ok = cancelJob(c.req.param('id'));
  if (!ok) return c.json({ error: 'cannot cancel job' }, 400);
  return c.json({ ok: true });
});

ingestRoutes.get('/jobs/:id/stream', (c) => {
  const jobId = c.req.param('id');
  const job = getJob(jobId);
  if (!job) return c.json({ error: 'job not found' }, 404);

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });

    const unsub = subscribeJob(jobId, (evt) => {
      send(evt.event, evt.data);
    });

    await send('job_progress', {
      done: job.stats.done + job.stats.failed + job.stats.skipped,
      total: job.stats.total,
    });

    const heartbeat = setInterval(() => {
      send('heartbeat', {});
    }, 15_000);

    try {
      while (job.status === 'pending' || job.status === 'running') {
        await stream.sleep(500);
        const current = getJob(jobId);
        if (!current) break;
        if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
          break;
        }
      }
      const final = getJob(jobId);
      if (final) {
        await send('job_done', { stats: final.stats, limitNotice: final.limitNotice });
      }
    } finally {
      clearInterval(heartbeat);
      unsub();
    }
  });
});
