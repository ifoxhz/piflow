import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HealthResponse } from '@bluelamp/core';
import { getHealth, loadManifest, validateModel } from './model-manager.js';
import { ingestRoutes } from './routes/ingest.js';
import { documentRoutes } from './routes/documents.js';
import { chatRoutes } from './routes/chat.js';

const PORT = Number(process.env.BLUELAMP_RAG_PORT ?? 3847);

const app = new Hono();

app.use(
  '*',
  cors({
    origin: [
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'tauri://localhost',
      'http://tauri.localhost',
    ],
  }),
);

app.get('/health', async (c) => {
  const health: HealthResponse = await getHealth();
  const statusCode = health.status === 'ok' ? 200 : 503;
  return c.json(health, statusCode);
});

app.get('/models', async (c) => {
  const manifest = await loadManifest();
  const models = await Promise.all(
    manifest.models.map(async (entry) => ({
      ...entry,
      validation: await validateModel(entry),
    })),
  );
  return c.json({ models });
});

app.route('/ingest', ingestRoutes);
app.route('/documents', documentRoutes);
app.route('/chat', chatRoutes);

console.log(`[rag-server] listening on http://127.0.0.1:${PORT}`);

serve({ fetch: app.fetch, port: PORT });
