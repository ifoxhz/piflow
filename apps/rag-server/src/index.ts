import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { HealthResponse } from '@bluelamp/core';
import { initFileLogger } from './platform/file-logger.js';
import { getHealth } from './model-manager.js';
import { getModelsDir } from './platform/paths.js';
import { ingestRoutes } from './routes/ingest.js';
import { documentRoutes } from './routes/documents.js';
import { chatRoutes } from './routes/chat.js';
import { configRoutes } from './routes/config.js';
import { piflowRoutes } from './routes/piflow/index.js';
import { modelRoutes, startBackgroundRequiredModelEnsure } from './routes/models.js';
import { loadOllamaConfig } from './services/generation/ollama-config.js';
import { getOllamaUrl, isOllamaConfigured } from './services/generation/ollama.js';
import { piflowConfig } from './services/piflow/config.js';
import { getLlmProvider, loadLlmConfig } from './services/piflow/llm-settings.js';
import { isPostgresConfigured } from './services/piflow/postgres-settings.js';

const fileLog = initFileLogger();
const PORT = Number(process.env.PIFLOW_RAG_PORT ?? 3847);

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
  return c.json(health);
});

app.route('/models', modelRoutes);

app.route('/ingest', ingestRoutes);
app.route('/documents', documentRoutes);
app.route('/chat', chatRoutes);
app.route('/config', configRoutes);
app.route('/piflow', piflowRoutes);

await loadOllamaConfig();
await loadLlmConfig();

console.log(`[rag-server] listening on http://127.0.0.1:${PORT}`);
console.log(`[rag-server] log file → ${fileLog.logFile}`);
console.log(`[rag-server] models dir → ${getModelsDir()}`);
if (isOllamaConfigured()) {
  console.log(`[rag-server] Ollama generation → ${getOllamaUrl()}`);
} else {
  console.log('[rag-server] Ollama not configured (set via Settings or PIFLOW_OLLAMA_URL)');
}
console.log(`[rag-server] piFlow LLM provider → ${getLlmProvider()}`);
console.log(
  `[rag-server] piFlow postgres ${isPostgresConfigured() ? 'configured' : 'NOT configured (Settings → Postgres)'}` +
    ` · schemaCache=${piflowConfig.schemaCacheEnabled ? 'on' : 'OFF'}`,
);

serve({ fetch: app.fetch, port: PORT });
startBackgroundRequiredModelEnsure();
