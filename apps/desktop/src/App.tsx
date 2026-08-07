import { useCallback, useEffect, useState } from 'react';
import type { AppView, HealthResponse } from '@bluelamp/core';
import { ChatTimeoutError, fetchHealth, sendChatMessage } from './api/rag';
import { Sidebar } from './components/Sidebar';
import { WelcomeView } from './components/WelcomeView';
import { ChatView } from './components/ChatView';
import { ChatInput } from './components/ChatInput';
import { KnowledgeView } from './components/KnowledgeView';
import { PiFlowView } from './components/PiFlowView';
import { SettingsView } from './components/SettingsView';
import { useChatSessions } from './hooks/useChatSessions';
import './App.css';

const PLANNING_STORAGE_KEY = 'bluelamp-use-retrieval-plan';

function loadPlanningEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PLANNING_STORAGE_KEY);
    if (raw === null) return true;
    return raw === 'true';
  } catch {
    return true;
  }
}

function App() {
  const [view, setView] = useState<AppView>('welcome');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [planningEnabled, setPlanningEnabled] = useState(loadPlanningEnabled);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const handlePlanningChange = useCallback((enabled: boolean) => {
    setPlanningEnabled(enabled);
    try {
      localStorage.setItem(PLANNING_STORAGE_KEY, String(enabled));
    } catch {
      /* ignore quota */
    }
  }, []);

  const {
    activeChatId,
    messages,
    chatGroups,
    startNewChat,
    selectChat,
    ensureSession,
    addMessage,
    removeChat,
    renameChat,
  } = useChatSessions();

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
      setHealthError(null);
    } catch {
      setHealth(null);
      setHealthError(
        'Cannot reach RAG server at http://127.0.0.1:3847 (sidecar starting or not running)',
      );
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const timer = setInterval(loadHealth, 15000);
    return () => clearInterval(timer);
  }, [loadHealth]);

  const handleNewChat = () => {
    startNewChat();
    setInput('');
    setView('welcome');
  };

  const handleSelectChat = (id: string) => {
    selectChat(id);
    setView('chat');
  };

  const handleDeleteChat = (id: string) => {
    const wasActive = id === activeChatId;
    removeChat(id);
    if (wasActive) {
      setInput('');
      setView('welcome');
    }
  };

  const handleRenameChat = (id: string, title: string) => {
    renameChat(id, title);
  };

  const handleSend = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sending) return;

    const sessionId = ensureSession(message);
    const now = new Date().toISOString();

    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt: now,
    });

    setInput('');
    setView('chat');
    setSending(true);

    try {
      // `messages` is still the prior turns (React state); current user msg not included yet.
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const { reply, citations, retrievalPlan } = await sendChatMessage(message, {
        history,
        useRetrievalPlan: planningEnabled,
      });
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        createdAt: new Date().toISOString(),
        citations,
        retrievalPlan,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof ChatTimeoutError;
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: isTimeout
          ? detail
          : `请求失败：${detail}\n\n` +
            '若提示 Failed to fetch / 网络错误：确认 `pnpm dev:server` 在跑，且 Vite 已重启（代理超时已加长）。' +
            '问答本身可能需要几十秒到数分钟，请稍候勿重复连点。',
        createdAt: new Date().toISOString(),
      });
    } finally {
      setSending(false);
    }
  };

  const showWelcome = view === 'welcome' && messages.length === 0;

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        chatGroups={chatGroups}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onNavigate={setView}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
      />

      <main className="main-panel">
        {view === 'knowledge' && <KnowledgeView />}
        {view === 'piFlow' && <PiFlowView />}
        {view === 'settings' && (
          <SettingsView health={health} healthError={healthError} />
        )}
        {(view === 'welcome' || view === 'chat') && (
          <>
            {showWelcome ? (
              <WelcomeView onQuickAction={(prompt) => handleSend(prompt)} />
            ) : (
              <ChatView messages={messages} isWaiting={sending} />
            )}
            <div className="main-input-area">
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={() => handleSend()}
                disabled={sending}
                planningEnabled={planningEnabled}
                onPlanningChange={handlePlanningChange}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
