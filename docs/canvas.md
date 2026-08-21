# piFlow Canvas（结果画布）设计

> 对话流展示 **概况（summary）**；结构化细节在可展开/收起的 **Canvas** 中用模板呈现。  
> 相关：[piflow.md](piflow.md) · [architecture.md](architecture.md)

**文档版本：v0.1** · 2026-08-21 · C1 实现中

---

## 1. 目标与非目标

### 1.1 目标

| 诉求 | 说明 |
|------|------|
| 双通道 | **Chat = 概况**；**Canvas = 细节** |
| 概况优先 | 有可展示结果时，聊天流出现 **Summary Card**（结论 + 结构要点），可打开画布 |
| 实时 | SSE `artifact`；`pg_query` 等 tool `details` 由 Host 提升为表 |
| 可停靠 | 右栏默认；展开近全宽；收起为竖条 |
| 安全 | C1 **模板 + JSON payload**，不执行模型 HTML |

### 1.2 非目标（C1）

- 模型 HTML / `dangerouslySetInnerHTML` / 独立 Tauri 窗口
- 图表、自由 iframe（C2）
- 每次 `kb_search` 都开 Canvas（多跳噪声轮次只留 chat + Sources）

### 1.3 锁定决策

| 项 | 决定 |
|----|------|
| 分工 | Chat：大结构 + 总结；Canvas：行级/字段级细节 |
| 协议 | `artifact` JSON；Host 模板渲染 |
| 触发 | Host 从 tool `details` 提升；`ui_present` 可补标题/解读 |
| 容器 | 同窗口右栏 |

---

## 2. 信息架构

| 放 Chat | 放 Canvas |
|---------|-----------|
| 一句话结论、3～7 条结构要点 | 全量表 / KPI 明细 |
| Summary Card +「打开画布」 | 可滚动表格 |
| tool pills、短 Markdown 解读 | 不展示原始 tool JSON |
| Sources `[n]` | — |

闲聊、无 tool、空结果：无 Canvas、无 Summary Card。

---

## 3. SSE `artifact`

```json
{
  "id": "art_1",
  "revision": 1,
  "kind": "table" | "kpis",
  "title": "string",
  "headline": "string",
  "outline": ["string"],
  "status": "streaming" | "ready",
  "sourceTool": "pg_query",
  "payload": {}
}
```

- `table` payload：`{ columns: { key, label }[], rows: object[], total?: number, truncated?: boolean }`
- `kpis` payload：`{ items: { label, value, hint? }[] }`
- 表最多 50 行进 Canvas；`outline` 写明总行数

落库：`piflow_messages.artifacts_json`

---

## 4. 实现对照（C1）

| 层 | 路径 |
|----|------|
| 类型 | `packages/core/src/canvas.ts` |
| 提升 | `apps/rag-server/src/services/piflow/artifacts.ts` |
| `ui_present` | `apps/rag-server/src/services/piflow/ui-tools.ts` |
| SSE | `apps/rag-server/src/routes/piflow/chat.ts` |
| UI | `CanvasPanel` · `SummaryCard` · `PiFlowView` |
