import { elapsedMs, nowMs } from '../chat/llm-query-log.js';
import { embedTexts } from '../ingestion/embedder.js';
import {
  GENERIC_FALLBACK_TEMPLATE,
  QUERY_TEMPLATES,
  getTemplateById,
  type QueryTemplate,
  type RoutableQueryTemplateId,
} from './query-templates.js';

/** Below this max exemplar cosine → treat as low confidence / use fallback hint recipe. */
const SCORE_THRESHOLD = Number(process.env.PIFLOW_TEMPLATE_SCORE_MIN ?? 0.42);

export interface TemplateRouteResult {
  template: QueryTemplate;
  score: number;
  /** Best matching exemplar text (for logs). */
  matchedExemplar?: string;
  lowConfidence: boolean;
  /** Cold-start: embed all template exemplars (0 when index already warm). */
  exemplarIndexMs: number;
  /** Embed the user query for cosine routing. */
  queryEmbedMs: number;
}

interface ExemplarEntry {
  templateId: RoutableQueryTemplateId;
  text: string;
  vector: Float32Array;
}

let index: ExemplarEntry[] | null = null;
let loading: Promise<void> | null = null;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i]! * b[i]!;
  return dot;
}

async function ensureIndex(): Promise<{ entries: ExemplarEntry[]; buildMs: number }> {
  if (index) return { entries: index, buildMs: 0 };
  if (loading) {
    const t0 = nowMs();
    await loading;
    return { entries: index!, buildMs: elapsedMs(t0) };
  }

  const buildStarted = nowMs();
  loading = (async () => {
    const texts: string[] = [];
    const meta: Array<{ templateId: RoutableQueryTemplateId; text: string }> = [];
    for (const t of QUERY_TEMPLATES) {
      for (const ex of t.exemplars) {
        texts.push(ex);
        meta.push({ templateId: t.id as RoutableQueryTemplateId, text: ex });
      }
    }
    console.log('[template-router] embedding %d exemplars…', texts.length);
    // No QUERY_PREFIX: question–question intent match, not passage retrieval.
    const vectors = await embedTexts(texts, { label: 'template-exemplars' });
    index = meta.map((m, i) => ({
      templateId: m.templateId,
      text: m.text,
      vector: vectors[i]!,
    }));
    console.log(
      '[template-router] ready (%d templates, %d exemplars, %dms)',
      QUERY_TEMPLATES.length,
      texts.length,
      elapsedMs(buildStarted),
    );
  })();

  await loading;
  return { entries: index!, buildMs: elapsedMs(buildStarted) };
}

/**
 * Route user message to a generic intent template via BGE-M3 cosine
 * against exemplar question shapes (max score per template).
 */
export async function routeQueryTemplate(message: string): Promise<TemplateRouteResult> {
  const { entries, buildMs: exemplarIndexMs } = await ensureIndex();
  const queryEmbedStarted = nowMs();
  const [queryVec] = await embedTexts([message.trim()], { label: 'template-route-query' });
  const queryEmbedMs = elapsedMs(queryEmbedStarted);
  if (!queryVec) {
    return {
      template: GENERIC_FALLBACK_TEMPLATE,
      score: 0,
      lowConfidence: true,
      exemplarIndexMs,
      queryEmbedMs,
    };
  }

  const bestByTemplate = new Map<
    RoutableQueryTemplateId,
    { score: number; exemplar: string }
  >();

  for (const e of entries) {
    const score = cosineSimilarity(queryVec, e.vector);
    const prev = bestByTemplate.get(e.templateId);
    if (!prev || score > prev.score) {
      bestByTemplate.set(e.templateId, { score, exemplar: e.text });
    }
  }

  let bestId: RoutableQueryTemplateId = 'summarize_overview';
  let bestScore = -1;
  let bestExemplar: string | undefined;
  for (const [id, v] of bestByTemplate) {
    if (v.score > bestScore) {
      bestScore = v.score;
      bestId = id;
      bestExemplar = v.exemplar;
    }
  }

  const lowConfidence = bestScore < SCORE_THRESHOLD;
  const matched = getTemplateById(bestId);
  const template: QueryTemplate = lowConfidence
    ? {
        ...matched,
        // Keep matched id for topK / logging; use conservative hint/recipe.
        answerHint: GENERIC_FALLBACK_TEMPLATE.answerHint,
        queryRecipe: `${matched.queryRecipe}（匹配置信度较低，查询务必紧扣原问。）`,
      }
    : matched;

  console.log(
    `[template-router] id=${bestId} score=${bestScore.toFixed(4)} low=${lowConfidence}` +
      ` exemplarIndex=${exemplarIndexMs}ms queryEmbed=${queryEmbedMs}ms` +
      (bestExemplar ? ` exemplar=${JSON.stringify(bestExemplar)}` : ''),
  );

  return {
    template,
    score: bestScore,
    matchedExemplar: bestExemplar,
    lowConfidence,
    exemplarIndexMs,
    queryEmbedMs,
  };
}
