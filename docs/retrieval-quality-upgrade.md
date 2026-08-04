# 检索质量升级设计：受控查询理解、Hybrid Retrieval 与排序融合

> 状态：提案  
> 关联：`docs/reRAG.md`、`apps/rag-server/src/services/retrieval/*`  
> 目标：在本地优先、可解释、可渐进发布的前提下，提高 RAG 的召回率与上下文精度。

---

## 1. 背景与结论

现有链路采用「意图模板路由 → LLM 生成 `denseQueries` → 多路 dense 搜索 → 以最高 cosine 合并」：

```text
message + history
  → template route
  → LLM RetrievalPlan.denseQueries
  → BGE-M3 dense retrieval
  → max cosine merge
  → answer LLM
```

它能处理口语化问句和多轮指代，但存在三个质量风险：

1. **原问被替代**：规划成功时只检索 LLM 输出；若 LLM 漏掉限定词、数字、否定或专名，原始检索意图丢失。
2. **扩展查询放大噪声**：任意一条过泛或偏移的子查询，都可以凭单个高 cosine chunk 主导最终排序。
3. **dense-only 的盲区未补齐**：版本号、专名、章节名、代码符号、精确引文和数字事实应由词法检索兜底。

本设计将 LLM 的职责缩小为**受控的查询理解**，并以原问为锚点，采用 Dense + SQLite FTS5/BM25 + RRF 的混合召回；可选 reranker 在融合候选上做最终精排。

```text
原问题（始终保留）
  ├─ 受控 standalone rewrite（仅在有上下文依赖时）
  ├─ 可选 sub-queries（仅复杂/多跳问题）
  ├─ Dense retrieval
  └─ SQLite FTS5 / BM25 retrieval
          ↓
        RRF 融合候选
          ↓
  可选 multilingual reranker + 多样性控制
          ↓
     最终上下文 → answer LLM
```

---

## 2. 目标与非目标

### 2.1 目标

- 不因 LLM 改写而丢失当前用户问题的约束。
- 可靠处理多轮中的指代、省略和承接表达。
- 提升专名、版本号、精确短语、章节/页码定位和数字事实的召回。
- 用排名融合而非不可比较的原始分数融合多路结果。
- 保留完整的查询、候选和排序轨迹，支持离线评测与回归。

### 2.2 非目标

- 不引入由 LLM 自由生成的 Lucene/SQL/FTS5 查询语法。
- 首版不要求使用 BGE-M3 sparse / ColBERT 输出；SQLite FTS5 是独立、低复杂度的词法通道。
- 不以增加 topK 替代排序质量提升。
- 不在未完成评测前将任意固定阈值、权重或模板视为最优值。

---

## 3. 查询理解：Standalone Rewrite

### 3.1 定义

**Standalone rewrite** 是将依赖聊天历史的当前问句，改写为一个不需要读取历史、但意图等价且可直接检索的完整问句。

它不是自由扩写、总结或改写风格；只允许补齐历史中已明确给出的实体和省略成分。

```text
history: 用户：中本聪是谁？
message: 他后来去哪了？

standaloneQuery: 中本聪后来去了哪里？其后续公开活动或身份线索是什么？
```

以下是不合格的输出：

```text
中本聪的完整人生经历和比特币历史
```

原因：它把「后来去哪」扩大为「完整人生经历」，并改变了信息需求边界。

### 3.2 数据契约

查询理解结果应与检索计划分离：

```ts
export interface QueryUnderstanding {
  /** 永远等于当前 message；不可由 LLM 修改或删除。 */
  originalQuery: string;
  /** 仅当需要消解指代/省略时存在；与 originalQuery 意图等价。 */
  standaloneQuery?: string;
  /** 仅复杂问题使用，最多 3 条，且每条都是可独立验证的子问题。 */
  subQueries: string[];
  /** 用户问题或历史中已出现的实体、术语、精确短语。 */
  keywords: string[];
  /** 便于观测与调试。 */
  rewriteReason?: 'coreference' | 'ellipsis' | 'multi_hop' | 'comparison';
}
```

`RetrievalPlan` 仍可保留 `templateId`、`answerHint` 与 `intent`，但不应再将 `denseQueries` 同时承担消解、改写和分解三种语义。

### 3.3 生成约束

查询理解模型必须遵守：

- `originalQuery` 由系统填入，不能由 LLM 输出覆盖。
- 仅从当前 message 和历史中提取实体/条件；禁止引入外部知识。
- 保留用户给出的专名、范围、时间、数量、否定及问句类型。
- 没有上下文依赖时，输出空 `standaloneQuery`，而不是同义改写。
- `subQueries` 只用于对比、多跳、时间线等确有多个证据面的任务；不可用同义句凑数。
- LLM 输出经 JSON schema 校验、长度限制、实体保留检查后才能进入检索；失败即仅使用原问。

### 3.4 检索策略

| 输入 | 何时使用 | 权重定位 |
|---|---|---|
| `originalQuery` | 始终 | 主锚点，最高权重 |
| `standaloneQuery` | 有明确指代/省略 | 补齐上下文，不替代原问 |
| `subQueries` | 复杂/多跳问题 | 扩展召回，数量严格受限 |
| `keywords` | 有可靠专名/符号/短语 | 驱动 FTS5，不直接拼接成自然语言 query |

---

## 4. Hybrid Retrieval：Dense + SQLite FTS5/BM25

### 4.1 两种通道解决不同问题

| 通道 | 擅长 | 弱点 |
|---|---|---|
| Dense / BGE-M3 | 同义表达、语义相关、跨语言表达 | 专名、版本号、代码符号、精确数字/短语可能不稳 |
| FTS5 / BM25 | 精确术语、标题、章节名、引文、代码和版本号 | 不理解同义词和隐含语义 |

两路是互补关系，不应以任一路替代另一路。

### 4.2 FTS5 索引

在 SQLite 中为每个 chunk 建立全文索引。索引文本应包含检索有价值的结构信息：文档标题、章节标题和正文。

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  title,
  heading,
  content,
  tokenize = 'unicode61'
);
```

索引更新必须与现有 `chunks` 写入和删除处于同一事务边界；文档重导入时同步删除旧 FTS 行，防止孤儿候选。

对于中文，首版可使用 `unicode61` 验证精确术语/Latin 混排效果；若中文自然语言的词法召回不足，再评估 SQLite FTS5 的 trigram tokenizer 或预分词方案。不要在没有实际语料评测前预设一种中文 tokenizer 一定最佳。

### 4.3 FTS 查询的安全构造

不允许 LLM 直接输出 FTS5 表达式。应用侧应：

1. 从 `originalQuery`、已校验的 `standaloneQuery`、`keywords` 中提取可靠 token；
2. 对 token 做转义与长度限制；
3. 将精确短语、代码符号、版本号和专名优先构造成受控 OR 查询；
4. FTS5 解析失败时回退到普通 token 查询或跳过本通道；
5. 记录最终 FTS query，但对 UI/API 默认不暴露内部语法。

例：

```text
原问：BGE-M3 的 QUERY_PREFIX 是什么？
可靠 token：BGE-M3、QUERY_PREFIX
受控 FTS query："BGE-M3" OR "QUERY_PREFIX"
```

### 4.4 Dense 查询与 BGE-M3 prefix

应将 `BGE-M3` 的 query prefix 配置化，并在评测集中对「无 prefix」和「当前英文 prefix」做 A/B。BGE 官方模型列表对 `BAAI/bge-m3` 未指定 retrieval query instruction，官方 BGE-M3 用例也直接编码句子；因此不应把其他 BGE 系列的英文指令默认视为 BGE-M3 的必需配置。

无论选择哪种配置，文档向量与查询向量的编码策略都必须在版本元数据中记录；修改 prefix 或 embedding 模型后必须全量重建索引。

---

## 5. RRF：用名次融合不同检索器

### 5.1 不直接相加原始分数

Dense cosine 与 BM25 数值没有共同量纲：

```text
cosine = 0.72
bm25   = 8.4
```

因此 `0.72 + 8.4` 没有可解释性，且不同 query 间的 cosine 也不能稳定横向比较。

### 5.2 Reciprocal Rank Fusion

RRF（倒数排名融合）只使用候选在每一路结果中的排名：

```text
RRF(d) = Σ weight_i / (k + rank_i(d))
```

- `d`：一个 chunk；
- `rank_i(d)`：它在第 `i` 路检索中的名次，从 1 开始；
- `weight_i`：该通道权重；
- `k`：平滑常数，首版建议 60，后续由评测校准；
- 某一路未召回该 chunk，则该路不贡献分数。

示例，`k = 60`：

| Chunk | Dense rank | BM25 rank | RRF |
|---|---:|---:|---:|
| A | 1 | 10 | `1/61 + 1/70 = 0.0307` |
| B | 2 | — | `1/62 = 0.0161` |
| C | 12 | 1 | `1/72 + 1/61 = 0.0303` |

A 同时被语义和词法通道认可，C 也因精确命中而保留，B 则不会只因一次 dense 命中占据优势。

### 5.3 建议的初始权重

以下仅是可评测的起点，不是最终常数：

```ts
const channels = [
  { id: 'dense-original', weight: 1.4 },
  { id: 'dense-standalone', weight: 1.0 },
  { id: 'dense-subquery', weight: 0.8 },
  { id: 'fts-bm25', weight: 1.2 },
];
```

原问权重最高，确保 LLM 改写不会反客为主；FTS5 对专名和精确短语有足够影响力；子查询只作为有限的召回扩展。

### 5.4 伪代码

```ts
interface RankedChunk { chunkId: string; rank: number }

export function reciprocalRankFusion(
  lists: Array<{ weight: number; results: RankedChunk[] }>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { weight, results } of lists) {
    for (const { chunkId, rank } of results) {
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + weight / (k + rank));
    }
  }
  return scores;
}
```

RRF 的输入必须是每个通道的独立有序列表，而非把所有 cosine 先混在一起排序。

---

## 6. 候选池、Rerank 与多样性

### 6.1 分离候选池与最终上下文

`perQueryK` 不能小于最终期望数量，否则单 query 时永远无法填满 `finalTopK`。例如 `finalTopK=12`、`perQueryK=8` 时，只有一条 query 最多只能得到 8 个 chunk。

建议拆分三个参数：

| 参数 | 初始建议 | 含义 |
|---|---:|---|
| `denseCandidateK` | 每通道 30 | Dense 初召回数 |
| `ftsCandidateK` | 30 | BM25 初召回数 |
| `rerankK` | 8–12 | 最终送入生成模型的 chunk 数 |

### 6.2 Reranker

RRF 后的前 30–60 个候选可由本地多语言 cross-encoder 重排，例如 `bge-reranker-v2-m3`。reranker 输入是 `(originalQuery, chunk-with-title-and-heading)` 对，输出更接近“该 chunk 是否能回答当前问题”的相关性。

rerank 的 query 应优先是 `originalQuery`；若存在 standalone rewrite，可作为拼接的检索上下文，但不能遮蔽原问的限定条件。

### 6.3 去冗余

最终上下文不应被同一段落的重叠 chunks 占满。首版可按以下规则实现：

- 同一 `documentId` 最多保留 N 条；
- 相邻 `charOffset` 的 chunk 至少间隔一个 chunk 才能同时保留；
- 后续再评估 MMR（Maximal Marginal Relevance）。

---

## 7. 端到端执行流程

```text
POST /chat { message, history }
  → QueryUnderstanding
      originalQuery = message
      standaloneQuery? / subQueries? / keywords?
  → template routing（建议基于 standaloneQuery ?? message）
  → Dense channels
      originalQuery            → top 30
      standaloneQuery?         → top 30
      subQueries[]?            → each top 30
  → FTS5/BM25 channel
      controlled terms/query   → top 30
  → RRF（按通道 rank + 权重融合）
  → 可选 reranker（top 30–60 → top 8–12）
  → 文档/相邻 chunk 去冗余
  → answer LLM（始终使用 originalQuery 回答）
```

若任意增强阶段失败：

- query understanding 失败：只用 `originalQuery`；
- FTS5 失败：只用 dense；
- reranker 失败：使用 RRF 排名；
- dense 失败但 FTS5 可用：允许使用 FTS5 结果，并在日志中标记 degraded。

---

## 8. 数据与可观测性

每一次检索记录以下数据，以便分析“改写是否实际带来增益”：

```ts
interface RetrievalTrace {
  originalQuery: string;
  standaloneQuery?: string;
  subQueries: string[];
  keywords: string[];
  templateId?: string;
  channels: Array<{
    id: string;
    query: string;
    candidateCount: number;
    rankedChunkIds: string[];
  }>;
  rrfCandidates: Array<{ chunkId: string; score: number; contributors: string[] }>;
  rerankedChunkIds?: string[];
  finalChunkIds: string[];
  degradedStages: string[];
}
```

日志须注意本地知识库内容可能敏感；保留现有本地日志策略，并提供关闭详细内容记录的配置。

---

## 9. 评测与发布门槛

### 9.1 最小评测集

在调节模板、topK、RRF 权重或 prompt 前，建立至少 50–100 条真实本地任务的评测集，并覆盖：

- 单点事实、数字和定义；
- 专名、版本号、代码符号；
- 文档/章节/页码定位；
- 列举、时间线、总结；
- 对比与多跳问题；
- 多轮指代、省略和话题切换；
- 中文、英文与中英混排。

每题至少标注可接受证据 chunk 或 document，必要时标注答案要点。

### 9.2 对照组

| 组别 | 目的 |
|---|---|
| A：原问 Dense | 当前最小可信基线 |
| B：原问 + standalone Dense | 验证改写本身价值 |
| C：Dense + FTS5 + RRF | 验证混合召回价值 |
| D：C + reranker | 验证精排的增益 |

至少观察 Recall@K、MRR/nDCG、context precision、答案忠实度、平均延迟与失败回退率。若 B、C 或 D 在关键任务上不能稳定优于 A，则不应默认开启对应增强阶段。

### 9.3 发布规则

- 保留按环境变量切换 baseline / hybrid / rerank 的能力；
- 对同一评测集做回归，禁止只看少量演示案例；
- 模型、prefix、chunking、FTS tokenizer 任一变化都应触发重新评测；
- BGE-M3 的 query prefix 改动必须全量重建向量索引。

---

## 10. 实施顺序

1. 定义 `QueryUnderstanding`，保证 `originalQuery` 永远进入 dense 检索；保留现有 fallback。
2. 增加 FTS5 表、入库同步、受控 FTS query 构造与删除同步。
3. 将当前“max cosine merge”替换为可观测的 RRF 融合；候选池与最终 topK 分离。
4. 建立离线评测集和 A/B 开关，校准 prefix、候选 K、RRF 权重、模板策略。
5. 接入本地 reranker，验证其延迟预算与质量增益后再默认开启。
6. 按评测结果再决定是否加入 MMR、BGE-M3 sparse/multi-vector 或自适应二次检索。

---

## 11. 参考

- [FlagEmbedding：BGE 模型与 reranker 官方说明](https://github.com/FlagOpen/FlagEmbedding)
- [BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3)
- [BGE-M3 技术报告](https://arxiv.org/abs/2402.03216)

