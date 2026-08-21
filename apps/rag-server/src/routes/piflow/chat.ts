import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createWorkflowSession } from '../../services/piflow/agent.js';
import {
  appendMessage,
  buildHistoryPrompt,
  createSession,
  getSession,
} from '../../services/piflow/chat-store.js';
import { piflowConfig } from '../../services/piflow/config.js';
import { createTurnObserver } from '../../services/piflow/turn-observer.js';

type ChatBody = {
  message?: string;
  sessionId?: string;
};

export const piflowChatRoutes = new Hono();

piflowChatRoutes.post('/', async (c) => {
  let body: ChatBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: 'message is required' }, 400);
  }

  let sessionId = body.sessionId?.trim();
  if (sessionId) {
    if (!getSession(sessionId)) {
      return c.json({ error: 'Session not found' }, 404);
    }
  } else {
    sessionId = createSession().id;
  }

  return streamSSE(c, async (stream) => {
    const send = async (event: string, data: unknown) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };

    const bundle = await createWorkflowSession();
    const { session } = bundle;
    let assistantText = '';
    let aborted = false;

    const obs = createTurnObserver({
      sessionId: sessionId!,
      message,
      toolBudget: piflowConfig.toolBudgetDisplay,
    });

    const abortTurn = () => {
      if (aborted) return;
      aborted = true;
      console.log(`[piflow:obs] abort requested session=${sessionId}`);
      void session.abort();
    };

    const reqSignal = c.req.raw.signal;
    const onReqAbort = () => abortTurn();
    reqSignal.addEventListener('abort', onReqAbort);

    // Serialize subscribe handlers so text/tools are not lost to races with prompt().
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      chain = chain.then(fn).catch(() => {
        /* client disconnected or write failed */
      });
      return chain;
    };

    const unsubscribe = session.subscribe((event) => {
      void enqueue(async () => {
        switch (event.type) {
          case 'message_update': {
            const ame = event.assistantMessageEvent;
            if (ame.type === 'text_delta') {
              assistantText += ame.delta;
              await send('text_delta', { delta: ame.delta });
            }
            break;
          }
          case 'tool_execution_start': {
            const budget = obs.onToolStart(event.toolName, event.toolCallId);
            await send('tool_start', {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              index: budget.index,
              toolBudget: budget.toolBudget,
              overBudget: budget.overBudget,
            });
            break;
          }
          case 'tool_execution_end': {
            obs.onToolEnd(event.toolCallId, event.isError);
            await send('tool_end', {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              isError: event.isError,
              result: event.isError ? undefined : event.result,
              toolCount: obs.toolCount,
              toolBudget: obs.toolBudget,
            });
            if (
              !event.isError &&
              typeof event.toolName === 'string' &&
              event.toolName.startsWith('kb_')
            ) {
              const citations = bundle.getCitations();
              if (citations.length > 0) {
                await send('citations', { citations });
              }
            }
            if (!event.isError) {
              let artifact = bundle.artifacts.promoteTool(event.toolName, event.result);
              if (!artifact && event.toolName === 'ui_present') {
                artifact = bundle.artifacts.latest();
              }
              if (artifact) {
                await send('artifact', artifact);
              }
            }
            break;
          }
          case 'agent_end':
            await send('agent_end', {});
            break;
          default:
            break;
        }
      });
    });

    try {
      await send('status', {
        phase: 'started',
        sessionId,
        toolBudget: obs.toolBudget,
        toolCount: 0,
      });

      const prompt = buildHistoryPrompt(sessionId!, message);
      appendMessage(sessionId!, 'user', message);

      await session.prompt(prompt);
      await chain;

      const citations = bundle.getCitations();
      const canvasArtifacts = bundle.artifacts.list();
      if (citations.length > 0) {
        await send('citations', { citations });
      }

      if (assistantText.trim()) {
        appendMessage(
          sessionId!,
          'assistant',
          assistantText.trim(),
          Date.now(),
          citations.length > 0 ? citations : undefined,
          canvasArtifacts.length > 0 ? canvasArtifacts : undefined,
        );
      }

      const meta = getSession(sessionId!);
      const summary = obs.finish({
        ok: !aborted,
        aborted,
        assistantText,
      });
      await send('done', {
        ok: !aborted,
        sessionId,
        title: meta?.title,
        updatedAt: meta?.updatedAt,
        aborted,
        toolCount: summary.toolCount,
        toolBudget: summary.toolBudget,
        overBudget: summary.overBudget,
        elapsedMs: summary.elapsedMs,
        citationCount: citations.length,
      });
    } catch (err) {
      await chain;
      const citations = bundle.getCitations();
      const canvasArtifacts = bundle.artifacts.list();
      if (assistantText.trim()) {
        try {
          appendMessage(
            sessionId!,
            'assistant',
            assistantText.trim(),
            Date.now(),
            citations.length > 0 ? citations : undefined,
            canvasArtifacts.length > 0 ? canvasArtifacts : undefined,
          );
        } catch {
          /* ignore persist failure */
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort =
        aborted ||
        reqSignal.aborted ||
        /abort/i.test(msg);
      console.error('[piflow] chat error:', msg);
      const summary = obs.finish({
        ok: false,
        aborted: isAbort,
        assistantText,
        error: msg,
      });
      if (!isAbort) {
        await send('error', { message: msg, sessionId });
      } else {
        await send('error', { message: '已停止', sessionId, aborted: true });
      }
      await send('done', {
        ok: false,
        sessionId,
        error: isAbort ? 'aborted' : msg,
        aborted: isAbort,
        toolCount: summary.toolCount,
        toolBudget: summary.toolBudget,
        overBudget: summary.overBudget,
        elapsedMs: summary.elapsedMs,
      });
    } finally {
      reqSignal.removeEventListener('abort', onReqAbort);
      unsubscribe();
      bundle.dispose();
    }
  });
});
