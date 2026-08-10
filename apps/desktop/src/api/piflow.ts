import type { Citation } from '@bluelamp/core';
import { getRagServerUrl } from './rag';

export type PiFlowSessionSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  timeLabel: string;
};

export type PiFlowGroupedSessions = {
  today: PiFlowSessionSummary[];
  week: PiFlowSessionSummary[];
  older: PiFlowSessionSummary[];
};

export type PiFlowMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  tools?: string[];
  citations?: Citation[];
};

export type PostgresConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  configured: boolean;
  connectionString?: string;
};

export type PostgresSaveResult = PostgresConfig & {
  ok: boolean;
  schemaWarm?: { ok: boolean; error?: string; tableCount?: number };
};

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data.error) return data.error;
  } catch {
    if (text) return text;
  }
  return `${fallback}: ${res.status}`;
}

export async function fetchPiFlowSessions(): Promise<PiFlowGroupedSessions> {
  const res = await fetch(`${getRagServerUrl()}/piflow/sessions`);
  if (!res.ok) throw new Error(await readError(res, '读取 piFlow 会话失败'));
  return res.json() as Promise<PiFlowGroupedSessions>;
}

export async function createPiFlowSession(title?: string): Promise<PiFlowSessionSummary> {
  const res = await fetch(`${getRagServerUrl()}/piflow/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(await readError(res, '创建 piFlow 会话失败'));
  return res.json() as Promise<PiFlowSessionSummary>;
}

export async function fetchPiFlowSession(id: string): Promise<{
  id: string;
  title: string;
  messages: PiFlowMessage[];
}> {
  const res = await fetch(`${getRagServerUrl()}/piflow/sessions/${id}`);
  if (!res.ok) throw new Error(await readError(res, '读取 piFlow 会话失败'));
  return res.json() as Promise<{ id: string; title: string; messages: PiFlowMessage[] }>;
}

export async function deletePiFlowSession(id: string): Promise<void> {
  const res = await fetch(`${getRagServerUrl()}/piflow/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, '删除 piFlow 会话失败'));
}

export async function renamePiFlowSession(
  id: string,
  title: string,
): Promise<PiFlowSessionSummary> {
  const res = await fetch(`${getRagServerUrl()}/piflow/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(await readError(res, '重命名 piFlow 会话失败'));
  return res.json() as Promise<PiFlowSessionSummary>;
}

export async function fetchPostgresConfig(): Promise<PostgresConfig> {
  const res = await fetch(`${getRagServerUrl()}/config/postgres`);
  if (!res.ok) throw new Error(await readError(res, '读取 Postgres 配置失败'));
  return res.json() as Promise<PostgresConfig>;
}

export async function savePostgresConfig(
  input: Partial<PostgresConfig> & { clear?: boolean },
): Promise<PostgresSaveResult> {
  const res = await fetch(`${getRagServerUrl()}/config/postgres`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, '保存 Postgres 配置失败'));
  return res.json() as Promise<PostgresSaveResult>;
}

export async function testPostgresConfig(
  input: Partial<PostgresConfig>,
): Promise<{ ok: boolean; error?: string; connectedDatabase?: string; connectedUser?: string }> {
  const res = await fetch(`${getRagServerUrl()}/config/postgres/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, '测试 Postgres 连接失败'));
  return res.json() as Promise<{
    ok: boolean;
    error?: string;
    connectedDatabase?: string;
    connectedUser?: string;
  }>;
}

export type PiFlowSkillInfo = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  ready: boolean;
  detail?: string;
};

export type PiFlowSkillSettings = {
  knowledge?: { enabled: boolean };
  postgres: { enabled: boolean };
  localFs: {
    enabled: boolean;
    workspacePath: string;
    allowWrite: boolean;
  };
};

export async function fetchPiFlowSkills(): Promise<{
  skills: PiFlowSkillInfo[];
  settings: PiFlowSkillSettings;
}> {
  const res = await fetch(`${getRagServerUrl()}/piflow/skills`);
  if (!res.ok) throw new Error(await readError(res, '读取 piFlow skills 失败'));
  return res.json() as Promise<{ skills: PiFlowSkillInfo[]; settings: PiFlowSkillSettings }>;
}

export async function savePiFlowSkillSettings(
  input: Partial<PiFlowSkillSettings>,
): Promise<{ settings: PiFlowSkillSettings; skills: PiFlowSkillInfo[] }> {
  const res = await fetch(`${getRagServerUrl()}/config/piflow-skills`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, '保存 piFlow skills 失败'));
  return res.json() as Promise<{ settings: PiFlowSkillSettings; skills: PiFlowSkillInfo[] }>;
}

export type PiFlowToolBudgetEvent = {
  toolName: string;
  toolCallId?: string;
  index: number;
  toolBudget: number;
  overBudget?: boolean;
};

export type PiFlowSseHandlers = {
  onStatus?: (data: {
    phase: string;
    sessionId: string;
    toolBudget?: number;
    toolCount?: number;
  }) => void;
  onTextDelta?: (delta: string) => void;
  onToolStart?: (data: PiFlowToolBudgetEvent) => void;
  onCitations?: (citations: Citation[]) => void;
  onError?: (message: string, meta?: { aborted?: boolean }) => void;
  onDone?: (data: {
    ok?: boolean;
    sessionId: string;
    title?: string;
    updatedAt?: number;
    error?: string;
    aborted?: boolean;
    toolCount?: number;
    toolBudget?: number;
    overBudget?: boolean;
    elapsedMs?: number;
    citationCount?: number;
  }) => void;
};

/** Soft UI budget; server may send its own via status/tool_start. */
export const PIFLOW_TOOL_BUDGET_DEFAULT = 10;

/** Parse SSE frames from a fetch body stream. */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length) onEvent(event, dataLines.join('\n'));
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export async function sendPiFlowMessage(
  message: string,
  sessionId: string | null,
  handlers: PiFlowSseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${getRagServerUrl()}/piflow/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message, sessionId: sessionId ?? undefined }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(await readError(res, 'piFlow 对话失败'));
  }

  let sawDone = false;
  await consumeSse(
    res.body,
    (event, data) => {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        switch (event) {
          case 'status':
            handlers.onStatus?.(
              parsed as {
                phase: string;
                sessionId: string;
                toolBudget?: number;
                toolCount?: number;
              },
            );
            break;
          case 'text_delta':
            if (typeof parsed.delta === 'string') handlers.onTextDelta?.(parsed.delta);
            break;
          case 'tool_start':
            if (typeof parsed.toolName === 'string') {
              handlers.onToolStart?.({
                toolName: parsed.toolName,
                toolCallId:
                  typeof parsed.toolCallId === 'string' ? parsed.toolCallId : undefined,
                index: typeof parsed.index === 'number' ? parsed.index : 0,
                toolBudget:
                  typeof parsed.toolBudget === 'number'
                    ? parsed.toolBudget
                    : PIFLOW_TOOL_BUDGET_DEFAULT,
                overBudget: Boolean(parsed.overBudget),
              });
            }
            break;
          case 'citations': {
            const list = parsed.citations;
            if (Array.isArray(list)) {
              handlers.onCitations?.(list as Citation[]);
            }
            break;
          }
          case 'error':
            handlers.onError?.(
              typeof parsed.message === 'string' ? parsed.message : 'Unknown error',
              { aborted: Boolean(parsed.aborted) },
            );
            break;
          case 'done':
            sawDone = true;
            handlers.onDone?.(
              parsed as {
                ok?: boolean;
                sessionId: string;
                title?: string;
                updatedAt?: number;
                error?: string;
                aborted?: boolean;
                toolCount?: number;
                toolBudget?: number;
                overBudget?: boolean;
                elapsedMs?: number;
                citationCount?: number;
              },
            );
            break;
          default:
            break;
        }
      } catch {
        /* ignore malformed frames */
      }
    },
    signal,
  );

  if (!sawDone && signal?.aborted) {
    handlers.onDone?.({
      ok: false,
      sessionId: sessionId ?? '',
      aborted: true,
      error: 'aborted',
    });
    return;
  }

  if (!sawDone && !signal?.aborted) {
    handlers.onError?.('连接中断：未收到完成事件，请重试');
  }
}
