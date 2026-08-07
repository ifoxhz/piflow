import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPiFlowSession,
  deletePiFlowSession,
  fetchPiFlowSession,
  fetchPiFlowSessions,
  fetchPiFlowSkills,
  PIFLOW_TOOL_BUDGET_DEFAULT,
  sendPiFlowMessage,
  type PiFlowGroupedSessions,
  type PiFlowMessage,
  type PiFlowSessionSummary,
  type PiFlowSkillInfo,
} from '../api/piflow';
import { MarkdownContent } from './MarkdownContent';

type UiMessage = PiFlowMessage & { tools?: string[] };

function flattenSessions(grouped: PiFlowGroupedSessions): Array<{
  label: string;
  sessions: PiFlowSessionSummary[];
}> {
  return [
    { label: '今天', sessions: grouped.today },
    { label: '最近一周', sessions: grouped.week },
    { label: '更早', sessions: grouped.older },
  ].filter((g) => g.sessions.length > 0);
}

export function PiFlowView() {
  const [grouped, setGrouped] = useState<PiFlowGroupedSessions>({
    today: [],
    week: [],
    older: [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
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

  const reloadSessions = useCallback(async () => {
    try {
      const next = await fetchPiFlowSessions();
      setGrouped(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reloadSkills = useCallback(async () => {
    try {
      const next = await fetchPiFlowSkills();
      setSkills(next.skills);
    } catch {
      /* keep previous list */
    }
  }, []);

  useEffect(() => {
    void reloadSessions();
    void reloadSkills();
  }, [reloadSessions, reloadSkills]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, toolCount]);

  const selectSession = async (id: string) => {
    setError(null);
    setActiveId(id);
    setLastTurnStats(null);
    try {
      const detail = await fetchPiFlowSession(id);
      setMessages(detail.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleNewChat = async () => {
    setError(null);
    setLastTurnStats(null);
    try {
      const session = await createPiFlowSession();
      setActiveId(session.id);
      setMessages([]);
      await reloadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePiFlowSession(id);
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await reloadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
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
        activeId,
        {
          onStatus: (data) => {
            if (data.sessionId) setActiveId(data.sessionId);
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
            void reloadSessions();
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
      setSending(false);
      abortRef.current = null;
    }
  };

  const groups = flattenSessions(grouped);

  return (
    <div className="piflow-view">
      <aside className="piflow-sessions">
        <div className="piflow-sessions-header">
          <h2>piFlow</h2>
          <button type="button" className="btn-secondary" onClick={() => void handleNewChat()}>
            新对话
          </button>
        </div>
        <div className="piflow-hint">
          <p>piFlow 是智能 agent， skill 列表</p>
          <ul>
            {(skills.length > 0
              ? skills.filter((s) => s.id !== 'no-delete-data')
              : [
                  {
                    id: 'postgres-readonly',
                    name: 'Postgres 只读',
                    enabled: true,
                    ready: false,
                    description: '',
                    detail: '配置见 Settings',
                  },
                ]
            ).map((s) => (
              <li key={s.id} className={s.enabled && s.ready ? undefined : 'is-muted'}>
                {s.name}
                {s.detail ? ` · ${s.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
        {error && <p className="status-error piflow-inline-error">{error}</p>}
        <div className="piflow-session-list">
          {groups.length === 0 && <div className="chat-list-empty">暂无对话</div>}
          {groups.map((group) => (
            <div key={group.label} className="chat-group">
              <div className="chat-group-label">{group.label}</div>
              <ul className="chat-list">
                {group.sessions.map((s) => (
                  <li key={s.id} className={`chat-item ${activeId === s.id ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="chat-item-main"
                      onClick={() => void selectSession(s.id)}
                    >
                      <span className="chat-item-title">{s.title}</span>
                      <span className="chat-item-time">{s.timeLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="chat-item-delete"
                      title="删除"
                      onClick={() => void handleDelete(s.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <section className="piflow-chat">
        <div className="piflow-messages">
          {messages.length === 0 && (
            <div className="piflow-empty">
              <h3>用自然语言查询 Postgres</h3>
              <p>例如：列出 public schema 下的表，或统计某张表的行数。</p>
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
