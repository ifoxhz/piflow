import { Hono } from 'hono';
import { ask } from '../services/chat/orchestrator.js';

export const chatRoutes = new Hono();

chatRoutes.post('/', async (c) => {
  const body = await c.req.json<{ message?: string }>();
  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: 'message is required' }, 400);
  }

  try {
    const result = await ask(message);
    return c.json(result);
  } catch (err) {
    console.error('[chat] failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});
