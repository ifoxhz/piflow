import type {
  ChatHistoryMessage,
  RetrievalPlan,
} from '@bluelamp/core';
import { elapsedMs, logLlmQueryInput, nowMs } from '../chat/llm-query-log.js';
import {
  getOllamaUrl,
  isOllamaConfigured,
  ollamaChatComplete,
  resolveOllamaModel,
} from '../generation/ollama.js';
import type { QueryTemplate } from './query-templates.js';
import { routeQueryTemplate } from './template-router.js';

const PLAN_TIMEOUT_MS = Number(process.env.BLUELAMP_PLAN_TIMEOUT_MS ?? 30_000);
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2000;

export interface PlanStepTiming {
  templateRouteMs: number;
  /** Cold-start exemplar index build (subset of templateRouteMs). */
  exemplarIndexMs: number;
  /** User-query embed for routing (subset of templateRouteMs). */
  queryEmbedMs: number;
  planLlmMs: number;
}

export interface BuildRetrievalPlanResult {
  plan: RetrievalPlan;
  timing: PlanStepTiming;
}

export function fallbackPlan(message: string): RetrievalPlan {
  return {
    intent: 'other',
    denseQueries: [message],
    keywords: [],
    answerHint: '仅根据资料回答并引用；资料不足则说明未找到。',
  };
}

/** Clip history: last N messages and ≤ max chars (docs/reRAG.md). */
export function clipChatHistory(
  history: ChatHistoryMessage[] | undefined,
  maxMessages = MAX_HISTORY_MESSAGES,
  maxChars = MAX_HISTORY_CHARS,
): ChatHistoryMessage[] {
  if (!history?.length) return [];

  const cleaned = history
    .filter((m) => m.content?.trim() && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content.trim() }));

  const recent = cleaned.slice(-maxMessages);
  const selected: ChatHistoryMessage[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]!;
    const next = chars + m.content.length;
    if (selected.length > 0 && next > maxChars) break;
    selected.push(m);
    chars = next;
  }
  return selected.reverse();
}

function buildPlanPrompt(
  message: string,
  history: ChatHistoryMessage[],
  template: QueryTemplate,
): string {
  const historyBlock =
    history.length === 0
      ? '（无）'
      : history.map((m) => `${m.role}: ${m.content}`).join('\n');

  return `你是检索规划器。系统已选定意图模板 ${template.id}（对应 intent=${template.intent}）。模板名仅供你理解任务，禁止写入 denseQueries 或 keywords。
根据对话历史与当前问题，只输出一个 JSON 对象，不要 markdown，不要回答用户问题。

JSON 字段（仅这些）：
- denseQueries: 字符串数组，1～5 条；内容是检索用自然语言/专名，不要出现模板英文 id
- keywords: 字符串数组，从用户问题抽取的专名/术语（可空数组）

查询配方（必须遵守）：
${template.queryRecipe}

通用规则：
- 用对话历史消解「他/这/上述」等指代，使 denseQueries 含具体实体
- 主题/专名只能来自用户问题或历史，禁止编造领域词
- 勿为凑数堆砌无信息量同义句
- 禁止把 inventory_sources、enumerate_entities、fact_lookup 等模板名当作查询词

## 对话历史
${historyBlock}

## 当前问题
${message}
`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('no JSON object in plan response');
}

const TEMPLATE_ID_LEAK =
  /\b(inventory_sources|enumerate_entities|summarize_overview|fact_lookup|locate_passage|explain_how|compare_two|generic_fallback)\b/gi;

function scrubDenseQuery(q: string): string {
  return q.replace(TEMPLATE_ID_LEAK, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePlanFromLlm(
  raw: unknown,
  message: string,
  template: QueryTemplate,
  templateScore: number,
  lowConfidence: boolean,
): RetrievalPlan {
  const base: RetrievalPlan = {
    intent: template.intent,
    denseQueries: [message],
    keywords: [],
    answerHint: template.answerHint,
    templateId: template.id,
    templateScore: Number(templateScore.toFixed(4)),
    lowConfidence,
  };

  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;

  const denseQueries = Array.isArray(obj.denseQueries)
    ? obj.denseQueries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => scrubDenseQuery(q.trim()))
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => scrubDenseQuery(k.trim()))
        .filter(Boolean)
        .slice(0, 12)
    : [];

  return {
    ...base,
    denseQueries: denseQueries.length > 0 ? denseQueries : [message],
    keywords,
    answerHint: template.answerHint,
  };
}

export async function buildRetrievalPlan(
  message: string,
  history?: ChatHistoryMessage[],
): Promise<BuildRetrievalPlanResult> {
  const clipped = clipChatHistory(history);

  const routeStarted = nowMs();
  const routed = await routeQueryTemplate(message);
  const templateRouteMs = elapsedMs(routeStarted);
  const { template, score, matchedExemplar, lowConfidence, exemplarIndexMs, queryEmbedMs } =
    routed;

  const attachMeta = (plan: RetrievalPlan): RetrievalPlan => ({
    ...plan,
    intent: template.intent,
    answerHint: template.answerHint || plan.answerHint,
    templateId: template.id,
    templateScore: Number(score.toFixed(4)),
    lowConfidence,
  });

  if (!isOllamaConfigured()) {
    console.warn('[query-plan] Ollama not configured, using template + original query');
    return {
      plan: attachMeta({
        intent: template.intent,
        denseQueries: [message],
        keywords: [],
        answerHint: template.answerHint,
      }),
      timing: { templateRouteMs, exemplarIndexMs, queryEmbedMs, planLlmMs: 0 },
    };
  }

  const prompt = buildPlanPrompt(message, clipped, template);
  const model = resolveOllamaModel(message);
  const endpoint = getOllamaUrl();

  try {
    const planLlmStarted = nowMs();
    const raw = await ollamaChatComplete(model, prompt, {
      temperature: 0,
      topP: 0.9,
      numPredict: 400,
      timeoutMs: PLAN_TIMEOUT_MS,
    });
    const planLlmMs = elapsedMs(planLlmStarted);

    const plan = normalizePlanFromLlm(
      extractJsonObject(raw),
      message,
      template,
      score,
      lowConfidence,
    );
    logLlmQueryInput({
      ts: new Date().toISOString(),
      stage: 'retrieval-plan',
      backend: 'ollama',
      model,
      endpoint,
      userQuery: message,
      prompt:
        prompt +
        `\n\n[router] template=${template.id} score=${score.toFixed(4)} lowConfidence=${lowConfidence}` +
        (matchedExemplar ? ` exemplar=${matchedExemplar}` : '') +
        `\n[timing] route=${templateRouteMs}ms exemplarIndex=${exemplarIndexMs}ms` +
        ` queryEmbed=${queryEmbedMs}ms planLlm=${planLlmMs}ms`,
      response: raw,
      retrievalPlan: plan,
    });
    console.log(
      `[query-plan] template=${plan.templateId} intent=${plan.intent}` +
        ` lowConfidence=${lowConfidence}` +
        ` queries=${JSON.stringify(plan.denseQueries)} keywords=${JSON.stringify(plan.keywords)}` +
        ` route=${templateRouteMs}ms exemplarIndex=${exemplarIndexMs}ms` +
        ` queryEmbed=${queryEmbedMs}ms planLlm=${planLlmMs}ms`,
    );
    return {
      plan,
      timing: { templateRouteMs, exemplarIndexMs, queryEmbedMs, planLlmMs },
    };
  } catch (err) {
    console.warn('[query-plan] failed, using template fallback:', err);
    const plan = attachMeta({
      intent: template.intent,
      denseQueries: [message],
      keywords: [],
      answerHint: template.answerHint,
    });
    logLlmQueryInput({
      ts: new Date().toISOString(),
      stage: 'retrieval-plan',
      backend: 'ollama',
      model,
      endpoint,
      userQuery: message,
      prompt,
      response: err instanceof Error ? `ERROR: ${err.message}` : `ERROR: ${String(err)}`,
      retrievalPlan: plan,
    });
    return {
      plan,
      timing: { templateRouteMs, exemplarIndexMs, queryEmbedMs, planLlmMs: 0 },
    };
  }
}
