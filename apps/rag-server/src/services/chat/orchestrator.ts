import type { ChatHistoryMessage, ChatResult, Citation, RetrievalPlan } from '@bluelamp/core';
import {
  elapsedMs,
  logPipelineTiming,
  nowMs,
  type PipelineTimingEntry,
} from './llm-query-log.js';
import {
  generateAnswerLocalLlm,
  isLocalLlmConfigured,
  preferLocalLlm,
} from '../generation/local-llm.js';
import {
  generateViaActiveLlm,
  isActiveLlmConfigured,
  resolveActiveLlm,
} from '../generation/active-llm.js';
import type { RagPromptOptions } from '../generation/rag-instruct-prompt.js';
import { generateAnswerLocal } from '../generation/pleias.js';
import { buildRetrievalPlan, fallbackPlan } from '../retrieval/query-plan.js';
import { resolveRetrievalTopK } from '../retrieval/query-templates.js';
import {
  searchChunks,
  searchWithQueries,
  toCitations,
  type ScoredChunk,
} from '../retrieval/retriever.js';

const USE_LOCAL_PLEIAS = process.env.BLUELAMP_USE_PLEIAS === 'true';

export interface AskOptions {
  /** When true: LLM builds RetrievalPlan then multi-query search. When false: raw query → vector search. */
  useRetrievalPlan?: boolean;
  history?: ChatHistoryMessage[];
}

function buildRetrievalAnswer(query: string, chunks: ScoredChunk[], note?: string): string {
  const lines = chunks.map((c, i) => {
    const excerpt = c.content.replace(/\s+/g, ' ').trim().slice(0, 400);
    return `**[${i + 1}] ${c.documentTitle}**\n${excerpt}`;
  });

  const header = note
    ? `${note}\n\n根据知识库检索，以下内容与「${query}」相关：`
    : `根据知识库检索，以下内容与「${query}」相关：`;

  return [header, '', ...lines, '', '以上摘自已导入文档，可参考对应 PDF 获取完整说明。'].join('\n');
}

function useGenerationBackend(): boolean {
  return isActiveLlmConfigured() || isLocalLlmConfigured() || USE_LOCAL_PLEIAS;
}

function toPromptOptions(plan: RetrievalPlan): RagPromptOptions {
  return {
    intent: plan.intent,
    answerHint: plan.answerHint,
  };
}

function resolveGenerationBackend(): PipelineTimingEntry['meta']['generation'] {
  if (isLocalLlmConfigured() && (preferLocalLlm() || !isActiveLlmConfigured())) {
    return 'local-llm';
  }
  if (isActiveLlmConfigured()) {
    return resolveActiveLlm().backend;
  }
  if (USE_LOCAL_PLEIAS) return 'pleias';
  return 'none';
}

async function generateAnswer(
  query: string,
  chunks: ScoredChunk[],
  plan: RetrievalPlan,
): Promise<string> {
  const opts = toPromptOptions(plan);
  if (isLocalLlmConfigured() && (preferLocalLlm() || !isActiveLlmConfigured())) {
    return generateAnswerLocalLlm(query, chunks, opts);
  }
  if (isActiveLlmConfigured()) {
    return generateViaActiveLlm(query, chunks, opts);
  }
  return generateAnswerLocal(query, chunks, opts);
}

function emptyResult(reply: string, plan: RetrievalPlan): ChatResult {
  return { reply, citations: [], retrievalPlan: plan };
}

export async function ask(
  query: string,
  historyOrOptions?: ChatHistoryMessage[] | AskOptions,
): Promise<ChatResult> {
  const options: AskOptions = Array.isArray(historyOrOptions)
    ? { history: historyOrOptions, useRetrievalPlan: true }
    : { useRetrievalPlan: true, ...historyOrOptions };
  const usePlan = options.useRetrievalPlan !== false;
  const history = options.history;

  const totalStarted = nowMs();
  let templateRouteMs: number | undefined;
  let exemplarIndexMs: number | undefined;
  let routeQueryEmbedMs: number | undefined;
  let planLlmMs: number | undefined;
  let planMs = 0;
  let retrieveMs = 0;
  let retrieveEmbedMs: number | undefined;
  let retrieveScoreMs: number | undefined;
  let generateMs: number | undefined;
  let generation: PipelineTimingEntry['meta']['generation'];
  let error: string | undefined;

  let plan: RetrievalPlan;
  const planStarted = nowMs();
  if (usePlan) {
    const built = await buildRetrievalPlan(query, history);
    plan = built.plan;
    templateRouteMs = built.timing.templateRouteMs;
    exemplarIndexMs = built.timing.exemplarIndexMs;
    routeQueryEmbedMs = built.timing.queryEmbedMs;
    planLlmMs = built.timing.planLlmMs;
  } else {
    plan = fallbackPlan(query);
  }
  planMs = elapsedMs(planStarted);

  const { finalTopK, perQueryK } = resolveRetrievalTopK(plan.templateId);
  const retrieveStarted = nowMs();
  const retrieved = usePlan
    ? await searchWithQueries(plan.denseQueries, finalTopK, perQueryK)
    : await searchChunks(query, finalTopK);
  const chunks = retrieved.chunks;
  retrieveEmbedMs = retrieved.embedMs;
  retrieveScoreMs = retrieved.scoreMs;
  retrieveMs = elapsedMs(retrieveStarted);

  const finishTiming = (chunkCount: number, gen?: PipelineTimingEntry['meta']['generation']) => {
    logPipelineTiming({
      ts: new Date().toISOString(),
      stage: 'pipeline',
      userQuery: query,
      useRetrievalPlan: usePlan,
      ms: {
        ...(templateRouteMs != null ? { templateRoute: templateRouteMs } : {}),
        ...(exemplarIndexMs != null ? { exemplarIndex: exemplarIndexMs } : {}),
        ...(routeQueryEmbedMs != null ? { routeQueryEmbed: routeQueryEmbedMs } : {}),
        ...(planLlmMs != null ? { planLlm: planLlmMs } : {}),
        plan: planMs,
        retrieve: retrieveMs,
        ...(retrieveEmbedMs != null ? { retrieveEmbed: retrieveEmbedMs } : {}),
        ...(retrieveScoreMs != null ? { retrieveScore: retrieveScoreMs } : {}),
        ...(generateMs != null ? { generate: generateMs } : {}),
        total: elapsedMs(totalStarted),
      },
      meta: {
        templateId: plan.templateId,
        denseQueryCount: plan.denseQueries.length,
        finalTopK,
        perQueryK,
        ...(plan.lowConfidence != null ? { lowConfidence: plan.lowConfidence } : {}),
        chunkCount,
        generation: gen,
        ...(error ? { error } : {}),
      },
    });
  };

  if (chunks.length === 0) {
    finishTiming(0, 'none');
    return emptyResult(
      '知识库中暂无已索引文档。请先在 Knowledge Base 导入文件夹后再提问。',
      plan,
    );
  }

  const citations: Citation[] = toCitations(chunks);

  if (!useGenerationBackend()) {
    generation = 'none';
    finishTiming(chunks.length, generation);
    return {
      reply: buildRetrievalAnswer(
        query,
        chunks,
        '未配置 Ollama，以下为知识库检索摘要（未经 LLM 整理）：',
      ),
      citations,
      retrievalPlan: plan,
    };
  }

  const genStarted = nowMs();
  try {
    const answer = await generateAnswer(query, chunks, plan);
    generateMs = elapsedMs(genStarted);
    generation = resolveGenerationBackend();
    finishTiming(chunks.length, generation);
    return { reply: answer, citations, retrievalPlan: plan };
  } catch (err) {
    generateMs = elapsedMs(genStarted);
    console.error('[chat] generation failed, using retrieval fallback:', err);
    error = err instanceof Error ? err.message : String(err);
    generation = 'retrieval-fallback';
    finishTiming(chunks.length, generation);
    const note =
      err instanceof Error && err.message.includes('fetch')
        ? '无法连接 Ollama 服务器，已改为展示检索摘要：'
        : undefined;
    return {
      reply: buildRetrievalAnswer(query, chunks, note),
      citations,
      retrievalPlan: plan,
    };
  }
}

/** Exported for tests / callers that need a deterministic empty plan shape. */
export { fallbackPlan };
