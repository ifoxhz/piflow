import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatSession, Message } from '@bluelamp/core';
import {
  appendMessage,
  createSession,
  deleteSession,
  groupSessionsByTime,
  loadSessions,
  renameSession,
  saveSessions,
  type ChatTimeGroup,
} from '../lib/chatStorage';

export type { ChatTimeGroup };

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

  const chatGroups: ChatTimeGroup[] = useMemo(
    () => groupSessionsByTime(sessions),
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

  const removeChat = useCallback((sessionId: string) => {
    setSessions((prev) => deleteSession(prev, sessionId));
    setActiveChatId((cur) => (cur === sessionId ? null : cur));
  }, []);

  const renameChat = useCallback((sessionId: string, title: string) => {
    setSessions((prev) => renameSession(prev, sessionId, title));
  }, []);

  return {
    sessions,
    activeChatId,
    messages,
    chatGroups,
    startNewChat,
    selectChat,
    ensureSession,
    addMessage,
    removeChat,
    renameChat,
  };
}
