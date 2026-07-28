import type { ChatSession, Message } from '@bluelamp/core';

const STORAGE_KEY = 'bluelamp-chat-sessions';

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function sessionTitleFromMessage(text: string, maxLen = 48): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (dayDiff === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 1) return '昨天';
  if (dayDiff < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Calendar-day distance from today (0 = today). */
export function dayDiffFromToday(iso: string, now = new Date()): number {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
}

export type ChatTimeGroupId = 'today' | 'yesterday' | 'last30' | 'older';

export interface ChatTimeGroup {
  id: ChatTimeGroupId;
  label: string;
  chats: Array<{ id: string; title: string; updatedAt: string }>;
}

const GROUP_ORDER: ChatTimeGroupId[] = ['today', 'yesterday', 'last30', 'older'];

const GROUP_LABELS: Record<ChatTimeGroupId, string> = {
  today: '今天',
  yesterday: '昨天',
  last30: '过去 30 天',
  older: '更早',
};

function groupIdForDayDiff(dayDiff: number): ChatTimeGroupId {
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff <= 30) return 'last30';
  return 'older';
}

/** Group sessions like DeepSeek: 今天 / 昨天 / 过去 30 天 / 更早. */
export function groupSessionsByTime(sessions: ChatSession[]): ChatTimeGroup[] {
  const buckets: Record<ChatTimeGroupId, ChatTimeGroup['chats']> = {
    today: [],
    yesterday: [],
    last30: [],
    older: [],
  };

  for (const s of sortSessionsByRecent(sessions)) {
    const id = groupIdForDayDiff(dayDiffFromToday(s.updatedAt));
    buckets[id].push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
  }

  return GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    chats: buckets[id],
  }));
}

export function sortSessionsByRecent(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function appendMessage(
  sessions: ChatSession[],
  sessionId: string,
  message: Message,
): ChatSession[] {
  const now = new Date().toISOString();
  return sessions.map((s) =>
    s.id === sessionId
      ? { ...s, messages: [...s.messages, message], updatedAt: now }
      : s,
  );
}

export function deleteSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}

export function renameSession(
  sessions: ChatSession[],
  sessionId: string,
  title: string,
): ChatSession[] {
  const next = title.replace(/\s+/g, ' ').trim();
  if (!next) return sessions;
  return sessions.map((s) => (s.id === sessionId ? { ...s, title: next } : s));
}

export function createSession(firstUserMessage: string): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: sessionTitleFromMessage(firstUserMessage),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}
