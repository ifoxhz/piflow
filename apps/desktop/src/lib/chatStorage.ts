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
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
