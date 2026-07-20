import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatSession, Message } from '@bluelamp/core';
import {
  appendMessage,
  createSession,
  formatChatTime,
  loadSessions,
  saveSessions,
  sortSessionsByRecent,
} from '../lib/chatStorage';

export interface RecentChatItem {
  id: string;
  title: string;
  time: string;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeChatId),
    [sessions, activeChatId],
  );

  const messages = activeSession?.messages ?? [];

  const recentChats: RecentChatItem[] = useMemo(
    () =>
      sortSessionsByRecent(sessions).map((s) => ({
        id: s.id,
        title: s.title,
        time: formatChatTime(s.updatedAt),
      })),
    [sessions],
  );

  const startNewChat = useCallback(() => {
    setActiveChatId(null);
  }, []);

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id);
  }, []);

  const ensureSession = useCallback(
    (firstUserText: string): string => {
      if (activeChatId && sessions.some((s) => s.id === activeChatId)) {
        return activeChatId;
      }
      const session = createSession(firstUserText);
      setSessions((prev) => [session, ...prev]);
      setActiveChatId(session.id);
      return session.id;
    },
    [activeChatId, sessions],
  );

  const addMessage = useCallback((sessionId: string, message: Message) => {
    setSessions((prev) => appendMessage(prev, sessionId, message));
  }, []);

  return {
    sessions,
    activeChatId,
    messages,
    recentChats,
    startNewChat,
    selectChat,
    ensureSession,
    addMessage,
  };
}
