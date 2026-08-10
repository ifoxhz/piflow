import { Hono } from 'hono';
import {
  createSession,
  deleteSession,
  formatSessionTime,
  getSession,
  listMessages,
  listSessionsGrouped,
  renameSession,
} from '../../services/piflow/chat-store.js';

export const piflowSessionRoutes = new Hono();

piflowSessionRoutes.get('/', (c) => {
  const grouped = listSessionsGrouped();
  const map = (sessions: ReturnType<typeof listSessionsGrouped>['today']) =>
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      timeLabel: formatSessionTime(s.updatedAt),
    }));

  return c.json({
    today: map(grouped.today),
    week: map(grouped.week),
    older: map(grouped.older),
  });
});

piflowSessionRoutes.post('/', async (c) => {
  let title = 'New chat';
  try {
    const body = await c.req.json();
    if (typeof body?.title === 'string' && body.title.trim()) {
      title = body.title.trim().slice(0, 80);
    }
  } catch {
    // empty body ok
  }
  const session = createSession(title);
  return c.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    timeLabel: formatSessionTime(session.updatedAt),
  });
});

piflowSessionRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  const session = getSession(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  const messages = listMessages(id).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
    ...(m.citations?.length ? { citations: m.citations } : {}),
  }));
  return c.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    timeLabel: formatSessionTime(session.updatedAt),
    messages,
  });
});

piflowSessionRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: { title?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body.title !== 'string') {
    return c.json({ error: 'title is required' }, 400);
  }
  try {
    const session = renameSession(id, body.title);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      timeLabel: formatSessionTime(session.updatedAt),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

piflowSessionRoutes.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!deleteSession(id)) return c.json({ error: 'Session not found' }, 404);
  return c.json({ ok: true });
});
