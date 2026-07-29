import fs from 'node:fs';
import path from 'node:path';
import type { RetrievalPlan } from '@bluelamp/core';
import { getDataDir } from '../../platform/paths.js';
import type { ScoredChunk } from '../retrieval/retriever.js';

export type LlmLogStage = 'generation' | 'query-rewrite' | 'retrieval-plan' | 'pipeline';

export interface LlmQueryLogEntry {
  ts: string;
  stage: LlmLogStage;
  backend: 'ollama' | 'local-llm' | 'pleias';
  model: string;
  endpoint?: string;
  userQuery: string;
  /** Full text sent to the LLM (prompt / chat user content) */
  prompt: string;
  /** Raw text returned by the LLM */
  response?: string;
  retrievalPlan?: RetrievalPlan;
  retrieved?: Array<{
    chunkId: string;
    documentTitle: string;
    score: number;
    contentPreview: string;
  }>;
}

/** Per-request wall-clock breakdown for ask(). */
export interface PipelineTimingEntry {
  ts: string;
  stage: 'pipeline';
  userQuery: string;
  useRetrievalPlan: boolean;
  ms: {
    /** Template exemplar routing (embed), only when planning on. */
    templateRoute?: number;
    /** Planning LLM call, only when planning on. */
    planLlm?: number;
    /** Full plan step (route + planLlm, or ~0 when planning off). */
    plan: number;
    /** Dense vector search (one or multi query). */
    retrieve: number;
    /** Answer generation LLM (absent if skipped / no backend). */
    generate?: number;
    total: number;
  };
  meta: {
    templateId?: string;
    denseQueryCount: number;
    /** Template-resolved merge topK (chunks fed to generation). */
    finalTopK?: number;
    /** Per dense-query retrieve depth before merge. */
    perQueryK?: number;
    chunkCount: number;
    generation?: 'ollama' | 'local-llm' | 'pleias' | 'retrieval-fallback' | 'none';
    error?: string;
  };
}

const PREVIEW_CHARS = 200;

function getLogDir(): string {
  return path.join(getDataDir(), 'logs');
}

function getLogPath(): string {
  return path.join(getLogDir(), 'llm-queries.jsonl');
}

function getTimingLogPath(): string {
  return path.join(getLogDir(), 'pipeline-timing.jsonl');
}

function ensureLogDir(): void {
  fs.mkdirSync(getLogDir(), { recursive: true });
}

export function summarizeChunksForLog(chunks: ScoredChunk[]) {
  return chunks.map((c) => ({
    chunkId: c.chunkId,
    documentTitle: c.documentTitle,
    score: Number(c.score.toFixed(4)),
    contentPreview: c.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS),
  }));
}

/** Append one JSONL record + mirror a short line to stdout for live debugging. */
export function logLlmQueryInput(entry: LlmQueryLogEntry): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry);
    fs.appendFileSync(getLogPath(), `${line}\n`, 'utf8');

    const retrievedN = entry.retrieved?.length ?? 0;
    const responseChars = entry.response?.length ?? 0;
    console.log(
      `[llm-log] ${entry.stage} backend=${entry.backend} model=${entry.model}` +
        ` query=${JSON.stringify(entry.userQuery)} promptChars=${entry.prompt.length}` +
        ` responseChars=${responseChars} retrieved=${retrievedN} file=${getLogPath()}`,
    );
  } catch (err) {
    console.warn('[llm-log] failed to write query log:', err);
  }
}

/** Wall-clock stage timings for one /chat ask — console + pipeline-timing.jsonl. */
export function logPipelineTiming(entry: PipelineTimingEntry): void {
  try {
    ensureLogDir();
    fs.appendFileSync(getTimingLogPath(), `${JSON.stringify(entry)}\n`, 'utf8');

    const { ms } = entry;
    const parts = [
      `plan=${ms.plan}ms`,
      ms.templateRoute != null ? `route=${ms.templateRoute}ms` : null,
      ms.planLlm != null ? `planLlm=${ms.planLlm}ms` : null,
      `retrieve=${ms.retrieve}ms`,
      ms.generate != null ? `generate=${ms.generate}ms` : null,
      `total=${ms.total}ms`,
    ].filter(Boolean);
    console.log(
      `[timing] usePlan=${entry.useRetrievalPlan} ${parts.join(' ')}` +
        ` chunks=${entry.meta.chunkCount} queries=${entry.meta.denseQueryCount}` +
        (entry.meta.finalTopK != null ? ` topK=${entry.meta.finalTopK}` : '') +
        (entry.meta.templateId ? ` template=${entry.meta.templateId}` : '') +
        (entry.meta.generation ? ` gen=${entry.meta.generation}` : '') +
        ` query=${JSON.stringify(entry.userQuery)}`,
    );
  } catch (err) {
    console.warn('[timing] failed to write pipeline timing log:', err);
  }
}

export function nowMs(): number {
  return performance.now();
}

export function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
}
