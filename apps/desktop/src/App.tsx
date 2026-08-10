import { useCallback, useEffect, useState } from 'react';
import type { AppView, HealthResponse } from '@bluelamp/core';
import { fetchHealth } from './api/rag';
import { Sidebar } from './components/Sidebar';
import { KnowledgeView } from './components/KnowledgeView';
import { PiFlowView } from './components/PiFlowView';
import { SettingsView } from './components/SettingsView';
import { usePiFlowSessions } from './hooks/usePiFlowSessions';
import './App.css';

function App() {
  const [view, setView] = useState<AppView>('piFlow');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const {
    activeChatId,
    chatGroups,
    startNewChat,
    selectChat,
    removeChat,
    renameChat,
    setActiveChatId,
    reloadSessions,
  } = usePiFlowSessions();

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

  const handleNewChat = async () => {
    await startNewChat();
    setView('piFlow');
  };

  const handleSelectChat = (id: string) => {
    selectChat(id);
    setView('piFlow');
  };

  const handleDeleteChat = (id: string) => {
    void removeChat(id);
  };

  const handleRenameChat = (id: string, title: string) => {
    void renameChat(id, title);
  };

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        chatGroups={chatGroups}
        activeChatId={activeChatId}
        onNewChat={() => void handleNewChat()}
        onSelectChat={handleSelectChat}
        onNavigate={setView}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
      />

      <main className="main-panel">
        {view === 'knowledge' && <KnowledgeView />}
        {view === 'piFlow' && (
          <PiFlowView
            sessionId={activeChatId}
            onSessionIdChange={setActiveChatId}
            onSessionsChanged={() => void reloadSessions()}
          />
        )}
        {view === 'settings' && (
          <SettingsView health={health} healthError={healthError} />
        )}
      </main>
    </div>
  );
}

export default App;
