import { useCallback, useEffect, useState } from 'react';
import type { AppView, HealthResponse } from '@bluelamp/core';
import { fetchHealth, sendChatMessage } from './api/rag';
import { Sidebar } from './components/Sidebar';
import { WelcomeView } from './components/WelcomeView';
import { ChatView } from './components/ChatView';
import { ChatInput } from './components/ChatInput';
import { KnowledgeView } from './components/KnowledgeView';
import { SettingsView } from './components/SettingsView';
import { useChatSessions } from './hooks/useChatSessions';
import './App.css';

function App() {
  const [view, setView] = useState<AppView>('welcome');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const {
    activeChatId,
    messages,
    recentChats,
    startNewChat,
    selectChat,
    ensureSession,
    addMessage,
  } = useChatSessions();

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
      setHealthError(null);
    } catch {
      setHealth(null);
      setHealthError('Cannot reach RAG server at http://127.0.0.1:3847');
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
      const { reply, citations } = await sendChatMessage(message);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: reply,
        createdAt: new Date().toISOString(),
        citations,
      });
    } catch {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to reach RAG server. Start it with: pnpm dev:server',
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
        recentChats={recentChats}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onNavigate={setView}
      />

      <main className="main-panel">
        {view === 'knowledge' && <KnowledgeView />}
        {view === 'settings' && (
          <SettingsView health={health} healthError={healthError} />
        )}
        {(view === 'welcome' || view === 'chat') && (
          <>
            {showWelcome ? (
              <WelcomeView onQuickAction={(prompt) => handleSend(prompt)} />
            ) : (
              <ChatView messages={messages} />
            )}
            <div className="main-input-area">
              <ChatInput
                value={input}
                onChange={setInput}
                onSend={() => handleSend()}
                disabled={sending}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
