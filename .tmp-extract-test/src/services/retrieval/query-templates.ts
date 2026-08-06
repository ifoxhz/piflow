import type { RetrievalIntent } from '@bluelamp/core';

/** Generic intent templates — exemplars are question shapes only, no domain topics. */
export type QueryTemplateId =
  | 'inventory_sources'
  | 'enumerate_entities'
  | 'summarize_overview'
  | 'fact_lookup'
  | 'locate_passage'
  | 'explain_how'
  | 'compare_two'
  | 'generic_fallback';

/** Templates that participate in exemplar embedding routing (excludes fallback). */
export type RoutableQueryTemplateId = Exclude<QueryTemplateId, 'generic_fallback'>;

export interface RetrievalTopK {
  /** Chunks kept after multi-query merge (fed to the answer LLM). */
  finalTopK: number;
  /** Chunks retrieved per dense query before merge. */
  perQueryK: number;
}

export interface QueryTemplate {
  id: QueryTemplateId;
  /** Maps onto RetrievalPlan.intent for generation logging. */
  intent: RetrievalIntent;
  /** Generic question shapes for embedding similarity (no KB-specific topics). */
  exemplars: string[];
  /** Forced generation constraint. */
  answerHint: string;
  /** Narrow instructions for the planning LLM when filling denseQueries. */
  queryRecipe: string;
  /** How many chunks to retrieve for this intent shape. */
  finalTopK: number;
  perQueryK: number;
}

/**
 * Default when templateId is missing / generic_fallback.
 * Depth policy from docs/reRAG.md §2.1 (2026-07-28): shallow for precise lookup,
 * deeper for overview / inventory; mid default for unknown.
 */
const DEFAULT_RETRIEVAL_TOP_K: RetrievalTopK = { finalTopK: 8, perQueryK: 6 };

const ROUTABLE_QUERY_TEMPLATE_MAP = {
  inventory_sources: {
    id: 'inventory_sources',
    intent: 'enumerate',
    exemplars: [
      '资料库里有哪些讲解了这个主题',
      '哪些文档提到了某某概念',
      '有哪些章节专门讨论该问题',
      'Which documents cover this topic?',
      '库里有没有相关材料，列一下来源',
      'What sources discuss this subject?',
      // Product / capability inventory (vs named-entity listing)
      '这个产品有哪些功能',
      '列出某系统的能力模块',
      '该软件支持哪些特性和模块',
      'What features does this product have?',
      'List the capabilities or modules of this system',
      // Source-inventory cues vs in-document locate
      '知识库里有哪些来源讲到这个',
      '帮我盘点相关文档和章节',
    ],
    answerHint:
      '只列出资料中明确论述该主题的文档、章节或产品功能/模块；不要把仅顺带提及或相邻主题算入；每项注明来源编号；没有则说明未找到。',
    queryRecipe:
      '从当前问题抽出主题词与产品/系统专名，生成 2～5 条 denseQueries：必须保留专名原文；可含「功能/模块/能力/定义/专节」等侧面；禁止空壳句如「相关文档与资源」；禁止丢掉产品名后扩写成泛「人工智能工具列表」等用户未提的上位领域词；不要引入用户未提及的领域词。',
    finalTopK: 12,
    perQueryK: 8,
  },
  enumerate_entities: {
    id: 'enumerate_entities',
    intent: 'enumerate',
    exemplars: [
      '资料里面涉及了多少个人物',
      '文中出现了哪些人名，列出来',
      'How many people are mentioned in the materials?',
      '文中点名了哪些对象或角色',
      'List the named people or characters discussed in the document',
      '这本书里提到了哪些具名人物',
      '资料中有哪些专有名词被点名',
      'Who are the named individuals in the sources?',
    ],
    answerHint:
      '只统计或列出资料中的具名项（人物、角色、被点名的专有对象）；署名、匿名类别、仅作背景的名称按题目要求区分说明；勿列出资料中未出现的名字；尽量给出数量或清单并引用。',
    queryRecipe:
      '生成 3～5 条 denseQueries，偏「具名人物/姓名/角色/被点名对象」；保留问题中的作品或范围词；「有哪些功能/能力/特性/模块」不是本模板（那是来源或功能盘点）；禁止把用户主题扩写成泛「人工智能/检测工具列表」等未提及上位词；避免只检索「筛选方法/统计流程」类方法论段落。',
    finalTopK: 12,
    perQueryK: 8,
  },
  summarize_overview: {
    id: 'summarize_overview',
    intent: 'summarize',
    exemplars: [
      '总结一下这份资料的主要内容',
      '这本书主要讲了什么',
      '用几点概括这一章的核心观点',
      'Summarize the key points of this document',
      '给我一个简短的内容概览',
      'What is this material mainly about?',
    ],
    answerHint:
      '分点概括资料中的要点；不引入资料未出现的论点；可引用编号。',
    queryRecipe:
      '生成 2～4 条 denseQueries，偏向导论、概述、结论、核心论点；保留用户指定的范围（某书/某章）。',
    finalTopK: 15,
    perQueryK: 10,
  },
  fact_lookup: {
    id: 'fact_lookup',
    intent: 'fact',
    exemplars: [
      '这件事发生在哪一年',
      '提出该理论的人是谁',
      '文中对这个术语的定义是什么',
      'When did this event take place according to the sources?',
      '关键结论或数据是什么',
      'What is the definition given in the document?',
      '这个东西是哪一年发布的',
      '资料里写的具体数字是多少',
    ],
    answerHint:
      '用一两句给出资料中的明确事实并引用；资料未写明则直说不知道，禁止猜测。',
    queryRecipe:
      '生成 1～3 条短 denseQueries，紧扣要查的事实槽（时间/人物/定义/数据）；保留专名原文。',
    finalTopK: 5,
    perQueryK: 5,
  },
  locate_passage: {
    id: 'locate_passage',
    intent: 'locate',
    exemplars: [
      '这个内容在哪一节',
      '找到讨论该问题的原文位置',
      '相关定义出现在文档的什么地方',
      'Where is the section that discusses this?',
      '这段论述在哪一页',
      'Which part of the document mentions this?',
      '第几章讲到了这个',
      '原文中是怎么写的，找一下',
      'Point me to the exact passage in the document',
      '帮我定位这句话在文档里的位置',
    ],
    answerHint:
      '指出文档名与章节或页码（若有）；简洁定位，不要展开成完整教程。',
    queryRecipe:
      '生成 2～4 条 denseQueries，保留用户要定位的独特短语或主题；偏章节标题与原文表述。注意：「有哪些材料讲了 X」不是 locate，那是盘点来源；「产品有哪些功能」也不是 locate。',
    finalTopK: 5,
    perQueryK: 5,
  },
  explain_how: {
    id: 'explain_how',
    intent: 'explain',
    exemplars: [
      '这个机制是怎么运作的',
      '解释一下文中描述的流程',
      '为什么要采用这种方法',
      'How does this process work according to the document?',
      '文中说的步骤是怎样的',
      'Explain the reason given in the sources',
      '这个观点是怎么论证的',
      '资料里如何说明该方法有效',
    ],
    answerHint:
      '仅根据资料解释步骤或原因；分点简述；不要引入资料外的理论体系。',
    queryRecipe:
      '生成 2～4 条 denseQueries，偏向机制、步骤、原因、流程描述；保留主题专名。',
    finalTopK: 8,
    perQueryK: 6,
  },
  compare_two: {
    id: 'compare_two',
    intent: 'compare',
    exemplars: [
      '这两种做法有什么区别',
      '对比一下文中的两者',
      '两者各有什么优劣，按资料说',
      'Compare these two approaches based on the documents',
      '有何不同',
      "What's the difference between them according to the sources?",
    ],
    answerHint:
      '按资料分点对比；每点可引用；资料未比较的维度不要补充。若对比对象超过两个，则为每个对象单独列点。',
    queryRecipe:
      '识别所有要对比的对象（通常为两个，也可能更多）；为每个对象生成至少一条 denseQuery，另可加一条整体「对比/区别」表述；保留专名。',
    finalTopK: 10,
    perQueryK: 6,
  },
} as const satisfies Record<RoutableQueryTemplateId, QueryTemplate>;

export const GENERIC_FALLBACK_TEMPLATE: QueryTemplate = {
  id: 'generic_fallback',
  intent: 'other',
  exemplars: [],
  answerHint:
    '仅根据资料回答并引用；资料不足则说明未找到。',
  queryRecipe:
      '生成 1～3 条 denseQueries，紧扣用户问题中的实体与主题；去掉寒暄。',
  ...DEFAULT_RETRIEVAL_TOP_K,
};

/** Full id → template map (compile-time completeness for all QueryTemplateId values). */
export const QUERY_TEMPLATE_MAP = {
  ...ROUTABLE_QUERY_TEMPLATE_MAP,
  generic_fallback: GENERIC_FALLBACK_TEMPLATE,
} as const satisfies Record<QueryTemplateId, QueryTemplate>;

/** Routable templates only — used to build the exemplar embedding index. */
export const QUERY_TEMPLATES: QueryTemplate[] = (
  Object.keys(ROUTABLE_QUERY_TEMPLATE_MAP) as RoutableQueryTemplateId[]
).map((id) => ROUTABLE_QUERY_TEMPLATE_MAP[id]);

export function getTemplateById(id: QueryTemplateId | string): QueryTemplate {
  if (id in QUERY_TEMPLATE_MAP) {
    return QUERY_TEMPLATE_MAP[id as QueryTemplateId];
  }
  return GENERIC_FALLBACK_TEMPLATE;
}

/** Resolve final/per-query topK from a routed template id (defaults when unknown). */
export function resolveRetrievalTopK(templateId?: string): RetrievalTopK {
  if (!templateId) return DEFAULT_RETRIEVAL_TOP_K;
  const matched = getTemplateById(templateId);
  if (matched.id === 'generic_fallback' && templateId !== 'generic_fallback') {
    return DEFAULT_RETRIEVAL_TOP_K;
  }
  return { finalTopK: matched.finalTopK, perQueryK: matched.perQueryK };
}
