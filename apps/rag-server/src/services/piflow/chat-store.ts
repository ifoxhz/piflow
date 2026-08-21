import crypto from 'node:crypto';
import type { CanvasArtifact, Citation } from '@bluelamp/core';
import { getDb } from '../../db.js';

export type PiFlowChatRole = 'user' | 'assistant' | 'system';

export type PiFlowChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type PiFlowChatMessage = {
  id: string;
  sessionId: string;
  role: PiFlowChatRole;
  content: string;
  createdAt: number;
  citations?: Citation[];
  artifacts?: CanvasArtifact[];
};

export type SessionBucket = 'today' | 'week' | 'older';

export type GroupedSessions = {
  today: PiFlowChatSession[];
  week: PiFlowChatSession[];
  older: PiFlowChatSession[];
};

function mapSession(row: {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}): PiFlowChatSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCitations(raw: string | null | undefined): Citation[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Citation[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseArtifacts(raw: string | null | undefined): CanvasArtifact[] | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as CanvasArtifact[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function mapMessage(row: {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  citations_json?: string | null;
  artifacts_json?: string | null;
}): PiFlowChatMessage {
  const citations = parseCitations(row.citations_json);
  const artifacts = parseArtifacts(row.artifacts_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as PiFlowChatRole,
    content: row.content,
    createdAt: row.created_at,
    ...(citations?.length ? { citations } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
  };
}

export function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/g, ' ').trim();
  if (!compact) return 'New chat';
  return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact;
}

export function createSession(title = 'New chat'): PiFlowChatSession {
  const now = Date.now();
  const session: PiFlowChatSession = {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO piflow_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run(session.id, session.title, session.createdAt, session.updatedAt);
  return session;
}

export function getSession(id: string): PiFlowChatSession | null {
  const row = getDb()
    .prepare(`SELECT id, title, created_at, updated_at FROM piflow_sessions WHERE id = ?`)
    .get(id) as
    | { id: string; title: string; created_at: number; updated_at: number }
    | undefined;
  return row ? mapSession(row) : null;
}

export function listSessions(): PiFlowChatSession[] {
  const rows = getDb()
    .prepare(
      `SELECT id, title, created_at, updated_at FROM piflow_sessions ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map(mapSession);
}

function startOfLocalDay(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function bucketFor(updatedAt: number, now = Date.now()): SessionBucket {
  const todayStart = startOfLocalDay(now);
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  if (updatedAt >= todayStart) return 'today';
  if (updatedAt >= weekStart) return 'week';
  return 'older';
}

export function listSessionsGrouped(now = Date.now()): GroupedSessions {
  const grouped: GroupedSessions = { today: [], week: [], older: [] };
  for (const session of listSessions()) {
    grouped[bucketFor(session.updatedAt, now)].push(session);
  }
  return grouped;
}

export function deleteSession(id: string): boolean {
  const database = getDb();
  const tx = database.transaction(() => {
    database.prepare(`DELETE FROM piflow_messages WHERE session_id = ?`).run(id);
    return database.prepare(`DELETE FROM piflow_sessions WHERE id = ?`).run(id);
  });
  const result = tx();
  return Number(result.changes ?? 0) > 0;
}

export function renameSession(id: string, title: string): PiFlowChatSession | null {
  const next = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!next) throw new Error('Title is required');
  const existing = getSession(id);
  if (!existing) return null;
  const updatedAt = Date.now();
  getDb()
    .prepare(`UPDATE piflow_sessions SET title = ?, updated_at = ? WHERE id = ?`)
    .run(next, updatedAt, id);
  return { ...existing, title: next, updatedAt };
}

export function listMessages(sessionId: string): PiFlowChatMessage[] {
  const rows = getDb()
    .prepare(
      `SELECT id, session_id, role, content, created_at, citations_json, artifacts_json
       FROM piflow_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(sessionId) as Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
    created_at: number;
    citations_json?: string | null;
    artifacts_json?: string | null;
  }>;
  return rows.map(mapMessage);
}

export function appendMessage(
  sessionId: string,
  role: PiFlowChatRole,
  content: string,
  createdAt = Date.now(),
  citations?: Citation[],
  artifacts?: CanvasArtifact[],
): PiFlowChatMessage {
  const session = getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const message: PiFlowChatMessage = {
    id: crypto.randomUUID(),
    sessionId,
    role,
    content,
    createdAt,
    ...(citations?.length ? { citations } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
  };

  const citationsJson =
    citations && citations.length > 0 ? JSON.stringify(citations) : null;
  const artifactsJson =
    artifacts && artifacts.length > 0 ? JSON.stringify(artifacts) : null;

  const database = getDb();
  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO piflow_messages (id, session_id, role, content, created_at, citations_json, artifacts_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.createdAt,
        citationsJson,
        artifactsJson,
      );

    const title =
      role === 'user' && session.title === 'New chat'
        ? titleFromMessage(content)
        : session.title;

    database
      .prepare(`UPDATE piflow_sessions SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, createdAt, sessionId);
  });
  tx();

  return message;
}

/** Build a compact prior-turn context for the next Pi prompt (prior only). */
export function buildHistoryPrompt(sessionId: string, nextUserMessage: string): string {
  const prior = listMessages(sessionId).filter((m) => m.role === 'user' || m.role === 'assistant');
  if (prior.length === 0) return nextUserMessage;

  const lines = prior.map((m) => {
    const label = m.role === 'user' ? 'User' : 'Assistant';
    return `${label}: ${m.content}`;
  });

  return [
    'The following is prior conversation in this session. Continue coherently.',
    '---',
    ...lines,
    '---',
    `User: ${nextUserMessage}`,
  ].join('\n');
}

export function formatSessionTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  if (startOfLocalDay(ts) === startOfLocalDay(now)) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const weekStart = startOfLocalDay(now) - 6 * 24 * 60 * 60 * 1000;
  if (ts >= weekStart) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}
