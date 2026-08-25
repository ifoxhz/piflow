import { Hono } from 'hono';
import {
  findModelEntry,
  getDownloadProgress,
  isRequiredEmbeddingReady,
  listModelsCatalog,
  startBackgroundRequiredModelEnsure,
  startEnsureModel,
} from '../model-manager.js';

export const modelRoutes = new Hono();

export { startBackgroundRequiredModelEnsure, isRequiredEmbeddingReady };

modelRoutes.get('/', async (c) => {
  const catalog = await listModelsCatalog();
  return c.json(catalog);
});

modelRoutes.post('/:id/download', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  let force = c.req.query('force') === '1';
  try {
    const body = await c.req.json<{ force?: boolean }>();
    if (body?.force) force = true;
  } catch {
    /* no body */
  }

  try {
    await findModelEntry(id);
    const { started, promise } = startEnsureModel(id, { force });
    void promise.catch(() => undefined);
    const catalog = await listModelsCatalog();
    const model = catalog.models.find((m) => m.id === id);
    return c.json(
      {
        started,
        model,
        progress: getDownloadProgress(id) ?? model?.progress,
      },
      started ? 202 : 200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, message.startsWith('Unknown model') ? 404 : 500);
  }
});
