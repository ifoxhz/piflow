# piFlow 设计文档（BlueLamp 主控 Agent）

> 基于 [Pi](https://pi.dev/) SDK 的工作流 Agent，作为 BlueLamp **主对话入口**；知识库 RAG 与 Postgres 等以 **Skill / Tools** 形式挂载。  
> 技术栈：TypeScript · pnpm monorepo · Hono · `@earendil-works/pi-coding-agent` · React（Tauri UI）

**相关文档**：[架构总览](architecture.md) · [用户手册](user-manual.zh.md)

**文档版本：v0.2** · Agent-first + knowledge-rag B1 · 2026-08

---

## 1. 目标与非目标

### 1.1 目标

| 诉求 | 说明 |
|------|------|
| Pi 主控 | **piFlow** 为唯一主对话壳；增强检索工作流由 Agent 编排 |
| RAG 插件化 | 知识库以 **薄 Tools** 暴露（方案 B）；模型按需检索 |
| 多源同会话 | 默认同时启用 **knowledge-rag** + **postgres-readonly** |
| Skill 可插拔 | KB / Postgres / Local FS 分开开关；关闭则不注入 prompt/tools |
| 引用（citations） | SSE 实时推送 + 消息落库；B1 展示 Sources UI（打开本地 PDF 留后续） |
| 查库策略 | 默认 **balanced**：闲聊可不调 tool；涉事实须 `kb_*` / `pg_*` |
| 可观测 | SSE 文本/tool；tool 软预算与 Stop |

### 1.2 非目标（B1）

- `kb_search_multi` / Host 内厚编排一锤子检索
- 点击 Sources 打开本地 PDF（B1 只做可展示的 Sources UI）
- 删除旧 `POST /chat` 实现（入口去掉，代码可暂留）
- Databases 侧栏、写库、多租户

### 1.3 已锁定产品决策

| 项 | 决定 |
|----|------|
| 主壳名称 | **piFlow** |
| 路线 | 方案 B（薄 KB tools） |
| 查库默认 | **balanced** |
| B1 工具 | `kb_list_documents` · `kb_search` · `kb_get_chunk` |
| 旧 RAG Chat UI | 入口去掉；默认进 piFlow；New Chat = 新建 piFlow 会话 |
| KB skill 就绪 | 默认 enabled；**导入文档后 `ready` 随库状态更新** |

---

## 2. 系统总览

```
┌──────────────────────────────────────────────────────────────┐
│  Desktop UI                                                  │
│  Sidebar：New Chat（piFlow 会话）· 会话列表 · Knowledge ·     │
│           piFlow · Settings                                  │
│  主区默认 = PiFlowView（SSE 对话 + tool pills + Sources）      │
│  Knowledge = 仅导入 / 文档管理（不承担主问答）                  │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP / SSE  :3847
┌────────────────────────────▼─────────────────────────────────┐
│  apps/rag-server · Pi Host                                   │
│  /piflow/chat · /sessions · /skills                          │
│  Skills: knowledge-rag · postgres-readonly · local-fs ·      │
│          no-delete-data                                      │
│  Tools: kb_* · pg_* · (read/bash/…)                          │
└───────────┬─────────────────────┬────────────────────────────┘
            ▼                     ▼
     bluelamp.db chunks      Postgres / 本地工作区
```

### 2.1 与旧 RAG Chat 的关系

| | 旧 RAG Chat（降级） | piFlow（主路径） |
|--|-------------------|------------------|
| 入口 | **已移除**（代码可暂留） | 默认视图 · New Chat |
| 大脑 | `orchestrator.ask`（内部可复用检索函数） | Pi `AgentSession` + tools |
| 协议 | `POST /chat` JSON | SSE `POST /piflow/chat` |
| 会话 | localStorage | `piflow_sessions` / `piflow_messages`（含 citations） |

---

## 3. Skill / 插件模型

| Skill ID | 默认 | ready 条件 | 工具 |
|----------|------|------------|------|
| `knowledge-rag` | **enabled** | 库中有可检索 chunk（导入后更新） | `kb_list_documents` · `kb_search` · `kb_get_chunk` |
| `postgres-readonly` | **enabled** | Settings 已配置 Postgres | `pg_list_*` · `pg_describe_table` · `pg_query` |
| `local-fs` | off | 工作区路径有效 | `read` / `bash` / 可选 `edit`/`write` |
| `no-delete-data` | 始终 | 始终 | 策略 |

Skill 目录：

```
apps/rag-server/skills/
├── knowledge-rag/SKILL.md
├── no-delete-data/SKILL.md
├── postgres-readonly/SKILL.md
├── local-fs/SKILL.md
└── _stash/postgres-readonly-references/
```

### 3.1 knowledge-rag（B1 薄工具）

| Tool | 入参 | 出参要点 |
|------|------|----------|
| `kb_list_documents` | 可选 `keyword` | 文档 id / title / path / chunkCount |
| `kb_search` | `query`，可选 `topK`、`documentId` | hits + citation 字段（sourceId、path、page、quote、chunkId…） |
| `kb_get_chunk` | `chunkId` | 原文 + 同一套 citation 字段 |

**不做（本阶段）**：`kb_search_multi`、Host 内 query-plan 一锤子工具。

**balanced 策略（skill 文案）**  
- 寒暄/闲聊：可不调 tool  
- 涉文档内容、专名、流程、事实：须先 `kb_*` 和/或 `pg_*`  
- 作答时对 KB 事实使用 citation 标记（如 `[1]`）

### 3.2 导入后更新 skill 状态

- `GET /piflow/skills` 的 `knowledge-rag.ready` 根据 `COUNT(chunks) > 0`（或文档数）计算  
- 导入任务完成后，UI 重新拉取 skills，使 detail 从「知识库为空」变为「已索引 N 篇/块」

### 3.3 LLM 后端

Settings → **模型配置**：Ollama / DeepSeek 互斥。当前提供方用于 **piFlow（主）**；旧 orchestrator 若仍被调用则共用同一配置。

---

## 4. 引用（citations）

### 4.1 两条通道

| 通道 | 用途 |
|------|------|
| **SSE** | 当轮实时：`citations` 事件（或随 `done` 附带），UI 立刻渲染 Sources |
| **消息落库** | `piflow_messages.citations_json`：重开会话仍可显示 Sources |

### 4.2 B1 UX

- 展示 Sources 列表（对齐旧 Chat 视觉）  
- **不**实现打开本地 PDF（后续阶段）  
- Postgres 来源可不进 citations 数组，或单独标注（B1 以 KB 为主）

---

## 5. 关键代码路径

| 职责 | 路径 |
|------|------|
| Pi 装配 | `apps/rag-server/src/services/piflow/agent.ts` |
| KB tools | `apps/rag-server/src/services/piflow/kb-tools.ts` |
| Skill 设置 | `apps/rag-server/src/services/piflow/skill-settings.ts` |
| 会话 / 引用落库 | `apps/rag-server/src/services/piflow/chat-store.ts` |
| SSE | `apps/rag-server/src/routes/piflow/chat.ts` |
| 检索复用 | `apps/rag-server/src/services/retrieval/retriever.ts` |
| 桌面主视图 | `apps/desktop/src/components/PiFlowView.tsx` · `App.tsx` |

---

## 6. HTTP / SSE

| 端点 | 说明 |
|------|------|
| `POST /piflow/chat` | `{ message, sessionId? }` → SSE |
| `/piflow/sessions*` | 会话 CRUD |
| `GET /piflow/skills` | skill 列表（含 KB ready） |
| `/config/piflow-skills` | 开关（含 `knowledge.enabled`） |
| `/config/llm` · `/config/postgres` | 模型与 PG |

### SSE 事件（B1）

| event | 含义 |
|-------|------|
| `status` | 开始 |
| `text_delta` | 文本增量 |
| `tool_start` / `tool_end` | 工具起止 |
| `citations` | `{ citations: Citation[] }` 当轮引用（可多次合并） |
| `agent_end` / `done` / `error` | 结束与错误 |

---

## 7. 数据落盘

| 位置 | 用途 |
|------|------|
| `bluelamp.db` → `chunks` / `documents` | 知识库 |
| `piflow_sessions` / `piflow_messages`（+ `citations_json`） | Agent 会话 |
| `piflow-skills.json` | 含 `knowledge.enabled` |
| `llm-config.json` / `ollama-config.json` / `postgres-config.json` | 配置 |

---

## 8. UI 行为（B1）

- 默认视图：**piFlow**  
- **New Chat** → 新建 piFlow 会话并进入 piFlow  
- 侧栏会话列表 = piFlow 会话（不再用 RAG localStorage 作为主列表）  
- Knowledge Base：导入与文档表；导入完成后刷新 skill 状态  
- Settings：模型 · Postgres · Local FS · knowledge skill 开关  

---

## 9. 观测与打断

| 能力 | 说明 |
|------|------|
| `tools n/budget` | 默认 `PIFLOW_TOOL_BUDGET=10`，B1 仍为软预算 |
| 停止 | abort fetch + `session.abort()` |
| 日志 | `[piflow:obs]` · `piflow-turns.jsonl` |

---

## 10. 后续阶段

| 阶段 | 内容 |
|------|------|
| B1（本文） | 主入口切换 · 3 个 kb tools · citations SSE+落库 · Sources UI · skill ready |
| B2 | 点击打开 PDF；balanced/strict Settings；`kb_search_multi`（可选） |
| B3 | tool 硬预算；弱模型降级 `kb_search_smart`；移除旧 Chat 代码路径 |

---

*对应实现以本文件 v0.2 为准。*
