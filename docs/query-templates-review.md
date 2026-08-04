# query-templates.ts 审阅与优化建议

## 落地裁决（2026-07-29）

对照实现后的结论与已落地项（**不要按未纠偏的原文改代码**）：

| # | 原建议 | 裁决 | 落地 |
|---|--------|------|------|
| 1 | fallback 独立 ID | **部分同意**；「低置信度混入 summarize 统计」不准确——低置信度路径会覆盖为 `bestId`。独立 ID 用于真·无向量/未知模板可观测 | `generic_fallback`；plan/timing 增加 `lowConfidence` |
| 2 | `satisfies` Record | **同意**；fallback **不入** exemplar 索引 | `QUERY_TEMPLATE_MAP` + `ROUTABLE_QUERY_TEMPLATE_MAP` |
| 3 | summarize intent | **同意** | `RetrievalIntent` 增加 `summarize` |
| 4 | compare 多侧 | **同意** | hint/recipe 文案已放宽 |
| 5 | inventory vs locate exemplars | **同意但不完整** | 已补 locate/inventory；**另修** inventory vs enumerate（蔡司「功能列表」串话） |
| 6 | topK 注释 | **同意动机**；**反对**伪造「2025-Q3 eval」 | 注释锚定 `docs/reRAG.md` §2.1 |
| 7 | 双语 hint/recipe | **暂缓** | 未做 |

**评审缺口已补：** 「有哪些功能/能力」→ 偏 `inventory_sources`；`enumerate_entities` 收窄为具名实体，recipe 禁止扩写成泛 AI 工具清单。

---

## 能力概述

`query-templates.ts` 是一个 RAG 检索路由系统的**模板注册表**，为七种可路由问题意图各提供一套执行参数（另加不可路由的 `generic_fallback`）。

| 模板 ID | 典型问题形态 | finalTopK |
|---|---|---|
| `inventory_sources` | 哪些文档讲了 X / 产品有哪些功能 | 12 |
| `enumerate_entities` | 文中有哪些人/具名对象 | 12 |
| `summarize_overview` | 总结这份材料 | 15 |
| `fact_lookup` | X 是哪年/谁/多少 | 5 |
| `locate_passage` | 这段话在哪一节 | 5 |
| `explain_how` | 这个机制怎么运作 | 8 |
| `compare_two` | 这两种做法有何区别 | 10 |
| `generic_fallback` | 无向量/未知 id（不参与 exemplar 路由） | 8 |

每个可路由模板挂载三样东西：

- **exemplars** — 用于路由器做 embedding 相似度匹配
- **queryRecipe** — 给 planning LLM 生成 denseQueries 的指令
- **answerHint** — 约束 answer LLM 的生成行为

另有 `resolveRetrievalTopK()` / `getTemplateById()` 工具函数。

---

## 优化建议

### 1. 给 fallback 独立 ID，消除歧义

**优先级：高 | 风险：低 | 改动量：小**

**问题：** `GENERIC_FALLBACK_TEMPLATE.id = 'summarize_overview'` 导致 fallback 流量混入 summarize 的 logging 统计，掩盖路由器的实际命中率。

```ts
// 现状
export const GENERIC_FALLBACK_TEMPLATE: QueryTemplate = {
  id: 'summarize_overview', // 借用了现有 ID
  ...DEFAULT_RETRIEVAL_TOP_K, // finalTopK: 8，但真正的 summarize_overview 是 15
  ...
};

// 建议
export type QueryTemplateId =
  | 'inventory_sources'
  | 'enumerate_entities'
  | 'summarize_overview'
  | 'fact_lookup'
  | 'locate_passage'
  | 'explain_how'
  | 'compare_two'
  | 'generic_fallback'; // 新增

export const GENERIC_FALLBACK_TEMPLATE: QueryTemplate = {
  id: 'generic_fallback', // 不再借用 summarize_overview
  intent: 'other',
  ...DEFAULT_RETRIEVAL_TOP_K,
  ...
};
```

**理由：** ID 是 logging 和分析的 key。分开后可独立监控 fallback 占比，判断路由器是否需要调优。

---

### 2. 用 `satisfies` 锁死 union 与数组的一致性

**优先级：高 | 风险：低 | 改动量：小**

**问题：** 新增或删除 `QueryTemplateId` 时，TypeScript 无法检测数组条目是否同步更新。

```ts
// 建议：改为 Record 结构，用 satisfies 约束
const QUERY_TEMPLATE_MAP = {
  inventory_sources:  { ... },
  enumerate_entities: { ... },
  summarize_overview: { ... },
  fact_lookup:        { ... },
  locate_passage:     { ... },
  explain_how:        { ... },
  compare_two:        { ... },
  generic_fallback:   GENERIC_FALLBACK_TEMPLATE,
} satisfies Record<QueryTemplateId, QueryTemplate>;

export const QUERY_TEMPLATES = Object.values(QUERY_TEMPLATE_MAP);
```

**理由：** 新增或删除 `QueryTemplateId` 后，`satisfies` 会立即报错，不需要人工核对数组。成本几乎为零，收益是永久的。

---

### 3. 给 `summarize_overview` 补上正确的 `intent`

**优先级：中 | 风险：低 | 改动量：小**

**问题：** `enumerate`、`fact`、`locate`、`explain`、`compare` 都有具名 intent，唯独 `summarize_overview` 使用 `intent: 'other'`，导致下游意图分布分析出现盲区。

```ts
// 建议：确认 @bluelamp/core 的 RetrievalIntent 是否已有合适值
intent: 'summarize', // 或 core 里已存在的等价值
```

**理由：** 若 `RetrievalIntent` 确实缺少 `summarize`，这是 core 层的遗漏，应同步向 `@bluelamp/core` 提 PR 修复。

---

### 4. 让 `compare_two` 能处理多侧对比

**优先级：中 | 风险：低 | 改动量：小**

**问题：** 模板名和 queryRecipe 都假设恰好两个比较对象，用户问"比较 A、B、C 三种方案"时会静默退化。

```ts
// answerHint 补充兜底说明
answerHint:
  '按资料分点对比；每点可引用；资料未比较的维度不要补充。' +
  '若对比对象超过两个，则为每个对象单独列点。',

// queryRecipe 放宽约束
queryRecipe:
  '识别所有要对比的对象（通常为两个，也可能更多），' +
  '为每个对象生成至少一条 denseQuery，另可加一条整体「对比/区别」表述；保留专名。',
```

**理由：** 不改模板 ID 和路由逻辑，只调整指令文本，改动最小，但可防止三元对比时 planning LLM 只检索两侧信息的截断问题。

---

### 5. 增强 exemplars 区分度，降低 `inventory_sources` / `locate_passage` 路由混淆

**优先级：中 | 风险：低 | 改动量：中**

**问题：** 两者语义相近，路由失误时 `finalTopK` 从 12 跌到 5，用户无感知。`locate_passage` 的 queryRecipe 已专门备注"「有哪些材料讲了 X」不是 locate"，说明设计者也意识到边界模糊。

```ts
// locate_passage exemplars 补充更明确的"单文档内定位"信号
exemplars: [
  '这个内容在哪一节',
  '找到讨论该问题的原文位置',
  '相关定义出现在文档的什么地方',
  'Where is the section that discusses this?',
  '这段论述在哪一页',
  'Which part of the document mentions this?',
  // 新增
  '第几章讲到了这个',
  '原文中是怎么写的，找一下',
  'Point me to the exact passage in the document',
],
```

同时在 `inventory_sources` exemplars 里补充"来源盘点"特征词，拉大两者的 embedding 距离。

**理由：** 路由器准确率直接取决于 exemplars 的区分度，增加有特征性的样本是成本最低的改善手段。

---

### 6. 给 topK 数值加注释说明来源

**优先级：低 | 风险：无 | 改动量：极小**

**问题：** `finalTopK` 和 `perQueryK` 的具体数值来源不明，后续调参没有基准，容易出现"盲目翻倍"或"调回默认值"的错误决策。

```ts
/**
 * Baseline: 5-query dense retrieval experiment on internal eval set v1, 2025-Q3.
 * fact_lookup / locate_passage 精确查询场景 topK 取低值减少噪声；
 * summarize_overview 需覆盖全文故取高值。
 */
const DEFAULT_RETRIEVAL_TOP_K: RetrievalTopK = { finalTopK: 8, perQueryK: 6 };
```

**理由：** 注释成本极低，但能为下一个调参的人保留决策上下文。

---

### 7. `answerHint` / `queryRecipe` 提供英文版本

**优先级：低（待验证） | 风险：低 | 改动量：中**

**问题：** exemplars 已覆盖双语，但 `answerHint` 和 `queryRecipe` 全为中文。planning/answer LLM 处理英文 query 时指令语言不一致，instruction-following 质量可能下降。

两种方案：

- **方案 A（轻量）：** 在每条中文指令末尾附上英文版，调用侧根据 query 语言动态选择语言段落。
- **方案 B（结构化）：** `QueryTemplate` 增加 `answerHintEn` / `queryRecipeEn` 可选字段，调用侧按语言路由。

**理由：** 在确认英文用户真实规模前，可先挂 TODO 标记，收集线上数据后再决定实施方案。

---

## 优先级汇总

| # | 建议 | 优先级 | 改动量 | 说明 |
|---|---|---|---|---|
| 1 | fallback 独立 ID | 高 | 小 | 数据正确性，立即可做 |
| 2 | `satisfies` 类型约束 | 高 | 小 | 编译安全，立即可做 |
| 3 | summarize intent 修正 | 中 | 小 | 需确认 core 层 `RetrievalIntent` 类型 |
| 4 | compare 多侧兜底 | 中 | 小 | 纯文本改动，无依赖 |
| 5 | 增强 exemplars 区分度 | 中 | 中 | 需配合路由器评估验证效果 |
| 6 | topK 注释 | 低 | 极小 | 可维护性，随手可做 |
| 7 | 双语指令 | 低 | 中 | 待线上数据确认场景后再做 |
