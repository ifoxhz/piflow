import { Hono } from 'hono';
import {
  getOllamaRuntimeConfig,
  updateOllamaConfig,
  type OllamaRuntimeConfig,
} from '../services/generation/ollama-config.js';
import { checkOllamaHealth } from '../services/generation/ollama.js';

export const configRoutes = new Hono();

configRoutes.get('/ollama', async (c) => {
  const config = getOllamaRuntimeConfig();
  const reachable = config.url ? await checkOllamaHealth() : false;
  return c.json({ ...config, reachable, configured: Boolean(config.url) });
});

configRoutes.put('/ollama', async (c) => {
  let body: Partial<OllamaRuntimeConfig>;
  try {
    body = (await c.req.json()) as Partial<OllamaRuntimeConfig>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (body.url !== undefined && typeof body.url !== 'string') {
    return c.json({ error: 'url must be a string' }, 400);
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    return c.json({ error: 'model must be a string' }, 400);
  }
  if (body.modelZh !== undefined && typeof body.modelZh !== 'string') {
    return c.json({ error: 'modelZh must be a string' }, 400);
  }

  if (typeof body.url === 'string' && body.url.trim()) {
    try {
      const parsed = new URL(body.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return c.json({ error: 'url must be http or https' }, 400);
      }
    } catch {
      return c.json({ error: 'url is not a valid URL' }, 400);
    }
  }

  const config = await updateOllamaConfig({
    url: body.url,
    model: body.model,
    modelZh: body.modelZh,
  });
  const reachable = config.url ? await checkOllamaHealth() : false;
  return c.json({ ...config, reachable, configured: Boolean(config.url) });
});
