import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPiFlowSession,
  deletePiFlowSession,
  fetchPiFlowSessions,
  renamePiFlowSession,
  type PiFlowGroupedSessions,
  type PiFlowSessionSummary,
} from '../api/piflow';
import type { ChatTimeGroup } from '../lib/chatStorage';

function toChatGroups(grouped: PiFlowGroupedSessions): ChatTimeGroup[] {
  const map = (
    id: ChatTimeGroup['id'],
    label: string,
    sessions: PiFlowSessionSummary[],
  ): ChatTimeGroup | null => {
    if (sessions.length === 0) return null;
    return {
      id,
      label,
      chats: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: new Date(s.updatedAt).toISOString(),
      })),
    };
  };

  return [
    map('today', '今天', grouped.today),
    map('last30', '最近一周', grouped.week),
    map('older', '更早', grouped.older),
  ].filter((g): g is ChatTimeGroup => g !== null);
}

export function usePiFlowSessions() {
  const [grouped, setGrouped] = useState<PiFlowGroupedSessions>({
    today: [],
    week: [],
    older: [],
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadSessions = useCallback(async () => {
    try {
      const next = await fetchPiFlowSessions();
      setGrouped(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  const chatGroups = useMemo(() => toChatGroups(grouped), [grouped]);

  const startNewChat = useCallback(async () => {
    try {
      const session = await createPiFlowSession();
      setActiveChatId(session.id);
      await reloadSessions();
      setError(null);
      return session.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [reloadSessions]);

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id);
  }, []);

  const removeChat = useCallback(
    async (id: string) => {
      try {
        await deletePiFlowSession(id);
        setActiveChatId((cur) => (cur === id ? null : cur));
        await reloadSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reloadSessions],
  );

  const renameChat = useCallback(
    async (id: string, title: string) => {
      try {
        await renamePiFlowSession(id, title);
        await reloadSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [reloadSessions],
  );

  return {
    chatGroups,
    activeChatId,
    setActiveChatId,
    error,
    reloadSessions,
    startNewChat,
    selectChat,
    removeChat,
    renameChat,
  };
}
