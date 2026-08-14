import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCitationLocation } from '@bluelamp/core';
import {
  fetchPiFlowSession,
  fetchPiFlowSkills,
  PIFLOW_TOOL_BUDGET_DEFAULT,
  sendPiFlowMessage,
  type PiFlowMessage,
  type PiFlowSkillInfo,
} from '../api/piflow';
import { PIFLOW_SKILLS_CHANGED_EVENT } from '../lib/piflowEvents';
import { MarkdownContent } from './MarkdownContent';

type UiMessage = PiFlowMessage & { tools?: string[] };

export type PiFlowViewProps = {
  sessionId: string | null;
  onSessionIdChange: (id: string | null) => void;
  onSessionsChanged: () => void;
};

export function PiFlowView({
  sessionId,
  onSessionIdChange,
  onSessionsChanged,
}: PiFlowViewProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<PiFlowSkillInfo[]>([]);
  const [toolCount, setToolCount] = useState(0);
  const [toolBudget, setToolBudget] = useState(PIFLOW_TOOL_BUDGET_DEFAULT);
  const [overBudget, setOverBudget] = useState(false);
  const [lastTurnStats, setLastTurnStats] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadGenRef = useRef(0);
  /** True while a turn is streaming; prevents sessionId bind from wiping live messages. */
  const sendingRef = useRef(false);

  const reloadSkills = useCallback(async () => {
    try {
      const next = await fetchPiFlowSkills();
      setSkills(next.skills);
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    void reloadSkills();
    const onSkillsChanged = () => {
      void reloadSkills();
    };
    window.addEventListener(PIFLOW_SKILLS_CHANGED_EVENT, onSkillsChanged);
    return () => window.removeEventListener(PIFLOW_SKILLS_CHANGED_EVENT, onSkillsChanged);
  }, [reloadSkills]);

  useEffect(() => {
    // First status of a null-session turn assigns sessionId; reloading here would
    // replace the optimistic user/assistant bubbles and drop all SSE updates.
    if (sendingRef.current) return;

    const gen = ++loadGenRef.current;
    setLastTurnStats(null);
    setError(null);

    if (!sessionId) {
      setMessages([]);
      return;
    }

    void (async () => {
      try {
        const detail = await fetchPiFlowSession(sessionId);
        if (loadGenRef.current !== gen) return;
        setMessages(detail.messages);
      } catch (err) {
        if (loadGenRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setMessages([]);
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, toolCount]);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    sendingRef.current = true;
    setError(null);
    setInput('');
    setToolCount(0);
    setOverBudget(false);
    setToolBudget(PIFLOW_TOOL_BUDGET_DEFAULT);
    setLastTurnStats(null);

    const userMsg: UiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), tools: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    let userStopped = false;

    try {
      await sendPiFlowMessage(
        text,
        sessionId,
        {
          onStatus: (data) => {
            // Bind sidebar to the server-created session without reloading messages mid-stream.
            if (data.sessionId) onSessionIdChange(data.sessionId);
            if (typeof data.toolBudget === 'number') setToolBudget(data.toolBudget);
            if (typeof data.toolCount === 'number') setToolCount(data.toolCount);
          },
          onTextDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + delta } : m,
              ),
            );
          },
          onToolStart: (data) => {
            setToolCount(data.index);
            setToolBudget(data.toolBudget);
            setOverBudget(Boolean(data.overBudget));
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, tools: [...(m.tools ?? []), data.toolName] }
                  : m,
              ),
            );
          },
          onCitations: (citations) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, citations } : m)),
            );
          },
          onError: (message, meta) => {
            if (meta?.aborted || message === '已停止') {
              userStopped = true;
              return;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: m.content
                        ? `${m.content}\n\n[error] ${message}`
                        : `[error] ${message}`,
                    }
                  : m,
              ),
            );
          },
          onDone: (data) => {
            if (typeof data.toolCount === 'number') setToolCount(data.toolCount);
            if (typeof data.toolBudget === 'number') setToolBudget(data.toolBudget);
            if (typeof data.overBudget === 'boolean') setOverBudget(data.overBudget);

            const parts: string[] = [];
            if (typeof data.toolCount === 'number' && typeof data.toolBudget === 'number') {
              parts.push(`tools ${data.toolCount}/${data.toolBudget}`);
              if (data.overBudget) parts.push('超预算');
            }
            if (typeof data.elapsedMs === 'number') {
              parts.push(`${Math.round(data.elapsedMs / 100) / 10}s`);
            }
            if (typeof data.citationCount === 'number' && data.citationCount > 0) {
              parts.push(`${data.citationCount} sources`);
            }
            if (data.aborted) parts.push('已停止');
            if (parts.length) setLastTurnStats(parts.join(' · '));

            if (data.aborted || userStopped) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: m.content
                          ? `${m.content}\n\n_（已停止）_`
                          : '_（已停止）_',
                      }
                    : m,
                ),
              );
            }
            onSessionsChanged();
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted || userStopped) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content ? `${m.content}\n\n_（已停止）_` : '_（已停止）_',
                }
              : m,
          ),
        );
        setLastTurnStats((prev) => prev ?? '已停止');
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `请求失败：${detail}` }
              : m,
          ),
        );
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
      abortRef.current = null;
    }
  };

  const visibleSkills =
    skills.length > 0
      ? skills.filter((s) => s.id !== 'no-delete-data')
      : [
          {
            id: 'knowledge-rag',
            name: 'Knowledge RAG',
            enabled: true,
            ready: false,
            description: '',
            detail: '导入文档后就绪',
          },
          {
            id: 'postgres-readonly',
            name: 'Postgres 只读',
            enabled: true,
            ready: false,
            description: '',
            detail: '配置见 Settings',
          },
        ];

  return (
    <div className="piflow-view">
      <section className="piflow-chat">
        <header className="piflow-chat-header">
          <div>
            <h2>piFlow</h2>
            <p className="piflow-hint-inline">智能 Agent · Skills</p>
          </div>
          <ul className="piflow-skill-chips">
            {visibleSkills.map((s) => (
              <li
                key={s.id}
                className={s.enabled && s.ready ? 'is-ready' : 'is-muted'}
                title={s.detail ?? s.description}
              >
                {s.name}
                {s.detail ? ` · ${s.detail}` : ''}
              </li>
            ))}
          </ul>
        </header>

        {error && <p className="status-error piflow-inline-error">{error}</p>}

        <div className="piflow-messages">
          {messages.length === 0 && (
            <div className="piflow-empty">
              <h3>用自然语言提问</h3>
              <p>
                可检索已导入知识库，或查询 Postgres（需在 Settings 配置）。闲聊可不调工具；事实类问题会走
                kb_* / pg_* tools。
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`piflow-msg ${m.role}`}>
              <div className="piflow-msg-role">{m.role === 'user' ? 'You' : 'piFlow'}</div>
              {m.tools && m.tools.length > 0 && (
                <div className="piflow-tools">
                  {m.tools.map((tool, i) => (
                    <span key={`${tool}-${i}`} className="piflow-tool-pill">
                      tool → {tool}
                    </span>
                  ))}
                </div>
              )}
              {m.role === 'assistant' ? (
                <MarkdownContent content={m.content || (sending ? '…' : '')} />
              ) : (
                <div className="piflow-user-text">{m.content}</div>
              )}
              {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                <div className="message-citations">
                  <div className="message-citations-title">Sources</div>
                  {m.citations.map((c) => {
                    const location = formatCitationLocation(c.page, c.heading);
                    return (
                      <div key={c.chunkId} className="message-citation">
                        <div className="message-citation-header">
                          <span className="message-citation-id">{c.sourceId}</span>
                          <span
                            className="message-citation-doc"
                            title={c.sourcePath ?? c.documentTitle}
                          >
                            {c.documentTitle}
                          </span>
                          {location && (
                            <span className="message-citation-location">{location}</span>
                          )}
                        </div>
                        <div className="message-citation-quote">
                          <MarkdownContent
                            content={c.quote}
                            className="markdown-content--compact"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="piflow-run-bar">
          {sending ? (
            <span className={`piflow-tool-meter ${overBudget ? 'is-over' : ''}`}>
              tools {toolCount}/{toolBudget}
              {overBudget ? ' · 已超软预算' : ''}
            </span>
          ) : lastTurnStats ? (
            <span className="piflow-tool-meter is-done">{lastTurnStats}</span>
          ) : (
            <span className="piflow-tool-meter is-idle">tools 0/{toolBudget}</span>
          )}
          {sending && (
            <button type="button" className="btn-secondary piflow-stop-btn" onClick={handleStop}>
              停止
            </button>
          )}
        </div>

        <div className="piflow-input-area">
          <textarea
            className="piflow-input"
            rows={2}
            value={input}
            placeholder="向 piFlow 提问…"
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={sending || !input.trim()}
            onClick={() => void handleSend()}
          >
            {sending ? '运行中…' : '发送'}
          </button>
        </div>
      </section>
    </div>
  );
}
