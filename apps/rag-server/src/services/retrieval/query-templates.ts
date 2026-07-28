import type { RetrievalIntent } from '@bluelamp/core';

/** Generic intent templates — exemplars are question shapes only, no domain topics. */
export type QueryTemplateId =
  | 'inventory_sources'
  | 'enumerate_entities'
  | 'summarize_overview'
  | 'fact_lookup'
  | 'locate_passage'
  | 'explain_how'
  | 'compare_two';

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
}

export const QUERY_TEMPLATES: QueryTemplate[] = [
  {
    id: 'inventory_sources',
    intent: 'enumerate',
    exemplars: [
      '资料库里有哪些讲解了这个主题',
      '哪些文档提到了某某概念',
      '有哪些章节专门讨论该问题',
      'Which documents cover this topic?',
      '库里有没有相关材料，列一下来源',
      'What sources discuss this subject?',
    ],
    answerHint:
      '只列出资料中明确论述该主题的文档或章节；不要把仅顺带提及或相邻主题算入；每项注明来源编号；没有则说明未找到。',
    queryRecipe:
      '从当前问题抽出主题词，生成 2～5 条 denseQueries：必须包含主题专名原文；可含「定义/专节/应用」等侧面；禁止空壳句如「相关文档与资源」；不要引入用户未提及的领域词。',
  },
  {
    id: 'enumerate_entities',
    intent: 'enumerate',
    exemplars: [
      '资料里面涉及了多少个人物',
      '文中出现了哪些人名，列出来',
      '这本书里提到了哪些关键概念',
      'How many people are mentioned in the materials?',
      '文中点名了哪些对象或角色',
      'List the named entities discussed in the document',
    ],
    answerHint:
      '只统计或列出资料中的具名项；署名、匿名类别、仅作背景的名称按题目要求区分说明；勿列出资料中未出现的名字；尽量给出数量或清单并引用。',
    queryRecipe:
      '生成 3～5 条 denseQueries，偏「具名/姓名/角色/专有名词清单」；保留问题中的作品或范围词；避免只检索「筛选方法/统计流程」类方法论段落。',
  },
  {
    id: 'summarize_overview',
    intent: 'other',
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
  },
  {
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
  },
  {
    id: 'locate_passage',
    intent: 'locate',
    exemplars: [
      '这个内容在哪一节',
      '找到讨论该问题的原文位置',
      '相关定义出现在文档的什么地方',
      'Where is the section that discusses this?',
      '这段论述在哪一页',
      'Which part of the document mentions this?',
    ],
    answerHint:
      '指出文档名与章节或页码（若有）；简洁定位，不要展开成完整教程。',
    queryRecipe:
      '生成 2～4 条 denseQueries，保留用户要定位的独特短语或主题；偏章节标题与原文表述。注意：「有哪些材料讲了 X」不是 locate，那是盘点来源。',
  },
  {
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
  },
  {
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
      '按资料分点对比；每点可引用；资料未比较的维度不要补充。',
    queryRecipe:
      '识别要对比的两侧（若有），为每侧至少一条 denseQuery，另可加一条「对比/区别」表述；保留专名。',
  },
];

export const GENERIC_FALLBACK_TEMPLATE: QueryTemplate = {
  id: 'summarize_overview',
  intent: 'other',
  exemplars: [],
  answerHint:
    '仅根据资料回答并引用；资料不足则说明未找到。',
  queryRecipe:
      '生成 1～3 条 denseQueries，紧扣用户问题中的实体与主题；去掉寒暄。',
};
