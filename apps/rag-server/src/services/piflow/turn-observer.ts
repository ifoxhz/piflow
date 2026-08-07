import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../../platform/paths.js';
import { piflowConfig } from './config.js';

export type ToolCallObs = {
  toolName: string;
  toolCallId: string;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
  durationMs?: number;
};

export type TurnObsSummary = {
  ts: string;
  sessionId: string;
  messagePreview: string;
  toolCount: number;
  toolBudget: number;
  overBudget: boolean;
  uniqueTools: Record<string, number>;
  errorToolCount: number;
  aborted: boolean;
  ok: boolean;
  elapsedMs: number;
  assistantChars: number;
  tools: Array<{
    toolName: string;
    toolCallId: string;
    isError?: boolean;
    durationMs?: number;
  }>;
};

function logPath(): string {
  return path.join(getDataDir(), 'logs', 'piflow-turns.jsonl');
}

export function createTurnObserver(opts: {
  sessionId: string;
  message: string;
  toolBudget?: number;
}) {
  const startedAt = Date.now();
  const toolBudget = opts.toolBudget ?? piflowConfig.toolBudgetDisplay;
  const tools: ToolCallObs[] = [];
  const byId = new Map<string, ToolCallObs>();

  const onToolStart = (toolName: string, toolCallId: string) => {
    const row: ToolCallObs = {
      toolName,
      toolCallId,
      startedAt: Date.now(),
    };
    tools.push(row);
    byId.set(toolCallId, row);
    console.log(
      `[piflow:obs] tool_start #${tools.length}/${toolBudget} ${toolName} session=${opts.sessionId}`,
    );
    return {
      index: tools.length,
      toolBudget,
      overBudget: tools.length > toolBudget,
    };
  };

  const onToolEnd = (toolCallId: string, isError: boolean) => {
    const row = byId.get(toolCallId);
    if (!row) return;
    row.endedAt = Date.now();
    row.isError = isError;
    row.durationMs = row.endedAt - row.startedAt;
    console.log(
      `[piflow:obs] tool_end ${row.toolName} err=${isError} ${row.durationMs}ms session=${opts.sessionId}`,
    );
  };

  const finish = (input: {
    ok: boolean;
    aborted: boolean;
    assistantText: string;
    error?: string;
  }): TurnObsSummary => {
    const uniqueTools: Record<string, number> = {};
    let errorToolCount = 0;
    for (const t of tools) {
      uniqueTools[t.toolName] = (uniqueTools[t.toolName] ?? 0) + 1;
      if (t.isError) errorToolCount += 1;
    }

    const summary: TurnObsSummary = {
      ts: new Date().toISOString(),
      sessionId: opts.sessionId,
      messagePreview: opts.message.replace(/\s+/g, ' ').trim().slice(0, 120),
      toolCount: tools.length,
      toolBudget,
      overBudget: tools.length > toolBudget,
      uniqueTools,
      errorToolCount,
      aborted: input.aborted,
      ok: input.ok,
      elapsedMs: Date.now() - startedAt,
      assistantChars: input.assistantText.length,
      tools: tools.map((t) => ({
        toolName: t.toolName,
        toolCallId: t.toolCallId,
        isError: t.isError,
        durationMs: t.durationMs,
      })),
    };

    console.log(
      `[piflow:obs] turn_done tools=${summary.toolCount}/${summary.toolBudget}` +
        ` over=${summary.overBudget} aborted=${summary.aborted} ok=${summary.ok}` +
        ` elapsed=${summary.elapsedMs}ms session=${opts.sessionId}` +
        (input.error ? ` error=${input.error}` : ''),
    );

    try {
      const file = logPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(summary)}\n`, 'utf8');
    } catch (err) {
      console.warn('[piflow:obs] failed to write jsonl:', err);
    }

    return summary;
  };

  return {
    toolBudget,
    get toolCount() {
      return tools.length;
    },
    onToolStart,
    onToolEnd,
    finish,
  };
}
