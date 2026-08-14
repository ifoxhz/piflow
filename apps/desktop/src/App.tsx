import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppView, HealthResponse } from '@bluelamp/core';
import { fetchHealth } from './api/rag';
import { BootstrapScreen } from './components/BootstrapScreen';
import { Sidebar } from './components/Sidebar';
import { KnowledgeView } from './components/KnowledgeView';
import { PiFlowView } from './components/PiFlowView';
import { SettingsView } from './components/SettingsView';
import { usePiFlowSessions } from './hooks/usePiFlowSessions';
import './App.css';

/** First-launch extract of rag-server.zip can take several minutes on slow disks. */
const BOOTSTRAP_TIMEOUT_MS = 5 * 60 * 1000;
const BOOTSTRAP_POLL_MS = 500;

type SidecarStatus = {
  phase?: string;
  detail?: string;
};

function App() {
  const [bootReady, setBootReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootElapsedSec, setBootElapsedSec] = useState(0);
  const [bootDetail, setBootDetail] = useState<string | null>(null);
  const [view, setView] = useState<AppView>('piFlow');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  /** Packaged shell finished extract/spawn; browser/dev skips the gate. */
  const sidecarPhaseRef = useRef<string | null>(null);
  const isTauriRef = useRef(
    typeof window !== 'undefined' &&
      ('__TAURI_INTERNALS__' in window || '__TAURI__' in window),
  );

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
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<SidecarStatus>('sidecar-status', (event) => {
          if (cancelled) return;
          const phase = event.payload?.phase ?? '';
          const detail = event.payload?.detail ?? '';
          sidecarPhaseRef.current = phase;
          if (detail) setBootDetail(detail);
          if (phase === 'error') {
            setBootError(detail || 'Sidecar failed');
          }
        });
      } catch {
        // Browser / Vite-only: no Tauri events.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    const tickElapsed = () => {
      if (!cancelled) {
        setBootElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
      }
    };
    const elapsedTimer = window.setInterval(tickElapsed, 1000);

    const waitForServer = async () => {
      while (!cancelled) {
        const phase = sidecarPhaseRef.current;
        if (phase === 'error') return;

        // Packaged app: ignore any pre-existing /health until OUR sidecar is ready.
        // Vite browser: no sidecar events → poll health immediately.
        const portableGate = !isTauriRef.current
          ? true
          : phase === 'spawned' || phase === 'ready' || phase === 'dev';

        if (portableGate) {
          try {
            const data = await fetchHealth();
            if (cancelled) return;
            setHealth(data);
            setHealthError(null);
            setBootReady(true);
            return;
          } catch {
            /* keep polling */
          }
        }

        if (Date.now() - startedAt >= BOOTSTRAP_TIMEOUT_MS) {
          if (!cancelled && sidecarPhaseRef.current !== 'error') {
            setBootError(
              '后端未能在时限内就绪 / Backend did not become ready in time (5 min).',
            );
          }
          return;
        }
        await new Promise((r) => setTimeout(r, BOOTSTRAP_POLL_MS));
      }
    };

    void waitForServer();
    return () => {
      cancelled = true;
      window.clearInterval(elapsedTimer);
    };
  }, []);

  useEffect(() => {
    if (!bootReady) return;
    void reloadSessions();
    void loadHealth();
    const timer = setInterval(() => void loadHealth(), 15000);
    return () => clearInterval(timer);
  }, [bootReady, loadHealth, reloadSessions]);

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

  if (!bootReady) {
    return (
      <BootstrapScreen
        error={bootError}
        elapsedSec={bootElapsedSec}
        detail={bootDetail}
      />
    );
  }

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
