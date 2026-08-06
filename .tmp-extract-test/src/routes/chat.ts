import type { ChatHistoryMessage } from '@bluelamp/core';
import { Hono } from 'hono';
import { ask } from '../services/chat/orchestrator.js';

export const chatRoutes = new Hono();

chatRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    message?: string;
    history?: ChatHistoryMessage[];
    useRetrievalPlan?: boolean;
  }>();
  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: 'message is required' }, 400);
  }

  const history = Array.isArray(body.history)
    ? body.history.filter(
        (m): m is ChatHistoryMessage =>
          !!m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string',
      )
    : undefined;

  const useRetrievalPlan = body.useRetrievalPlan !== false;

  try {
    const result = await ask(message, { history, useRetrievalPlan });
    return c.json(result);
  } catch (err) {
    console.error('[chat] failed', err);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});
