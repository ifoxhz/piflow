# piFlow 设计文档（BlueLamp 内置）

> 基于 [Pi](https://pi.dev/) SDK 的工作流 Agent，已并入 BlueLamp（raglamp）桌面应用与 `rag-server`。  
> 技术栈：TypeScript · pnpm monorepo · Hono · `@earendil-works/pi-coding-agent` · React（Tauri UI）

**相关文档**：[架构总览](architecture.md) · [用户手册](user-manual.zh.md)

---

## 1. 目标与非目标

### 1.1 目标

| 诉求 | 说明 |
|------|------|
| 可扩展工作流 | 以 Pi 为 harness，用 Skill / Tool 包扩展能力，而不是自建 agent loop |
| 与 RAG 并存 | 不替换现有 RAG `orchestrator`；侧栏独立入口 `piFlow` |
| Skill 可插拔 | **Postgres 只读** 与 **Local FS** 分开开关与配置 |
| 本地 / 内网优先 | LLM 复用 Settings 中的 Ollama；DB / 工作区由 Host 持有 |
| 可观测交互 | HTTP + SSE 推送文本增量与 tool 起止事件 |

### 1.2 非目标（当前）

- Databases 侧栏浏览（首版靠对话 + Settings 连接）
- 写库 / DDL / 任意 SQL
- 多租户、权限体系、完整审计
- 独立 `agent-host` 进程（已合并进 `:3847` rag-server）

---

## 2. 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop UI (React)                                         │
│  Sidebar → piFlow · Settings（Ollama / Postgres / Local FS） │
│  PiFlowView：会话列表 + SSE 对话 + tool pills                 │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTP / SSE  localhost:3847
┌────────────────────────────▼────────────────────────────────┐
│  apps/rag-server                                            │
│  /piflow/chat · /piflow/sessions · /piflow/skills           │
│  /config/ollama · /config/postgres · /config/piflow-skills  │
│                                                             │
│  services/piflow/                                           │
│    agent.ts · skill-settings.ts · chat-store.ts             │
│    postgres-settings / schema-service / ollama-bridge       │
│                                                             │
│  Pi Harness + packages/pg-actions + skills/*                │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
       LAN Ollama (/v1)              Postgres / 本地工作区
```
### 2.1 与 RAG 的关系

| | RAG Chat | piFlow |
|--|----------|--------|
| 入口 | New Chat / 欢迎页 | 侧栏 **piFlow** |
| 大脑 | `orchestrator.ask` | Pi `AgentSession` + tools |
| 协议 | JSON `POST /chat` | SSE `POST /piflow/chat` |
| 会话存储 | 前端 localStorage | `bluelamp.db` 表 `piflow_sessions` / `piflow_messages` |
| Ollama | Settings 同一套 | 同一套（`ollama-config.json`） |

---

## 3. Skill / 插件模型

Skill 与工具包**按需注入**：关闭的 skill 不进 system prompt，也不注册对应 tools。

| Skill ID | 说明 | 工具 | 配置 |
|----------|------|------|------|
| `postgres-readonly` | 自然语言只读查库 | `pg_list_*` / `pg_describe_table` / `pg_query` | Settings → Postgres；`.data/postgres-config.json` |
| `local-fs` | 工作区内读写本地文件 | `read` / `bash`（可选 `edit` / `write`） | Settings → Local FS；`.data/piflow-skills.json` |
| `no-delete-data` | 禁止删除/破坏数据 | （策略） | 始终启用 |

Skill 正文目录：

```
apps/rag-server/skills/
├── no-delete-data/SKILL.md
├── postgres-readonly/SKILL.md
├── local-fs/SKILL.md
└── _stash/postgres-readonly-references/   # 表关系文档暂存，默认不注入
    └── database-fields-and-relations.md
```

启用 Postgres skill 时默认只注入 `SKILL.md`。若要把表关系文档加回 prompt，把 `_stash/postgres-readonly-references/` 移回 `postgres-readonly/references/`（Host 会自动拼接 `references/*.md`，可用 `PIFLOW_SKILL_REF_MAX_CHARS` 截断）。

### LLM 后端

Settings → **模型配置**：Ollama / DeepSeek **互斥**（写入 `.data/llm-config.json`）。当前选中的提供方同时用于 **RAG**（检索规划 + 生成）与 **piFlow**。API 响应里 `deepseek.apiKey` 恒为空，表单不会从 `.env` 预填密钥。

Skill 开关文件（示例）：

```json
{
  "postgres": { "enabled": true },
  "localFs": {
    "enabled": false,
    "workspacePath": "D:\\dev\\my-project",
    "allowWrite": true
  }
}
```

### 3.1 Local FS 注意点

- `workspacePath` 必须是**已存在的绝对路径目录**
- Agent `cwd` 在启用 Local FS 时指向该工作区
- Windows 上 Pi 的 `bash` 依赖 **Git Bash**（或可执行的 `bash.exe`）；否则 `bash` tool 会失败
- 默认关闭 Local FS，避免模型误调不可用的 shell

### 3.2 Postgres 安全边界

- Skill + system prompt：禁止删除数据
- `packages/pg-actions` 的 `sql-guard`：硬拦截写/破坏性 SQL；单语句；自动 `LIMIT`
- Schema brief 注入 prompt（`.data/schema-cache/`）；保存连接时预热

---

## 4. 关键代码路径

| 职责 | 路径 |
|------|------|
| Pi 装配 | `apps/rag-server/src/services/piflow/agent.ts` |
| Skill 设置 | `apps/rag-server/src/services/piflow/skill-settings.ts` |
| 会话存储 | `apps/rag-server/src/services/piflow/chat-store.ts` |
| SSE 对话 | `apps/rag-server/src/routes/piflow/chat.ts` |
| Postgres tools | `packages/pg-actions/` |
| 桌面视图 | `apps/desktop/src/components/PiFlowView.tsx` |
| 前端 API | `apps/desktop/src/api/piflow.ts` |

---

## 5. HTTP / SSE 协议

均挂在 rag-server **`:3847`**（开发态前端经 Vite `/api` 代理）。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/piflow/chat` | POST | `{ message, sessionId? }` → SSE |
| `/piflow/sessions` | GET / POST | 列表（今天/一周/更早）/ 新建 |
| `/piflow/sessions/:id` | GET / PATCH / DELETE | 详情 / 重命名 / 删除 |
| `/piflow/skills` | GET | skill 列表 + 当前设置 |
| `/config/postgres` | GET / PUT | Postgres 连接；PUT 预热 schema |
| `/config/postgres/test` | POST | 探测连通性 |
| `/config/postgres/refresh-schema` | POST | 强制刷新 schema cache |
| `/config/piflow-skills` | GET / PUT | Skill 开关与 Local FS 工作区 |
| `/config/ollama` | GET / PUT | 与 RAG 共用 |

### SSE 事件

| event | data | 含义 |
|-------|------|------|
| `status` | `{ phase, sessionId }` | 开始 |
| `text_delta` | `{ delta }` | 文本增量 |
| `tool_start` / `tool_end` | tool 名与结果 | 工具起止 |
| `agent_end` | `{}` | Pi 一轮结束 |
| `done` | `{ ok, sessionId, title? }` | 完成（`ok: false` 表示失败收尾） |
| `error` | `{ message }` | 错误 |

Host 侧对订阅回调**串行化**，避免 `prompt()` 结束时丢增量；出错时尽量落库已生成的助手文本。

---

## 6. 数据与配置落盘

| 文件 / 表 | 用途 |
|-----------|------|
| `.data/bluelamp.db` → `piflow_sessions` / `piflow_messages` | piFlow 会话 |
| `.data/ollama-config.json` | Ollama（RAG + piFlow 共用） |
| `.data/postgres-config.json` | Postgres 连接 |
| `.data/piflow-skills.json` | Skill 开关与 Local FS |
| `.data/schema-cache/<hash>.json` | Schema brief 缓存 |
| `.data/piflow-agent/` | Pi `models.json` / `settings.json` |

---

## 7. 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 初始 Postgres URL（可被 UI 覆盖） |
| `PG_QUERY_TIMEOUT_MS` | 语句超时，默认 15000 |
| `PG_MAX_ROWS` | 查询行上限，默认 200 |
| `SCHEMA_CACHE_TTL_MS` | schema 缓存 TTL |
| `SCHEMA_BRIEF_MAX_CHARS` | brief 最大字符数 |
| `BLUELAMP_OLLAMA_URL` / `BLUELAMP_OLLAMA_MODEL` | 与 RAG 共用 |

完整列表见仓库根目录 [.env.example](../.env.example)。

---

## 8. UI 行为摘要

- 侧栏 footer：**Knowledge Base** · **piFlow** · **Settings**
- piFlow 页：独立会话列表 + 对话区；skill 状态来自 `/piflow/skills`
- Settings：Ollama · Postgres（连接 + skill 开关）· Local FS · RAG Server 健康状态

---

## 9. 观测与打断（当前）

| 能力 | 说明 |
|------|------|
| UI `tools n/budget` | 运行中显示调用次数；默认 budget=`PIFLOW_TOOL_BUDGET`（10），超预算标红，**暂不硬停** |
| UI「停止」 | 中止 fetch → 服务端 `session.abort()` |
| 日志 | 控制台 `[piflow:obs] …`；JSONL：`.data/logs/piflow-turns.jsonl`（含 tool 列表、是否超预算、是否 abort、耗时） |

用这些数据评估后续是否加硬预算 / 重复 SQL 去重。

## 10. 后续可选

- Host 硬预算：`maxToolCalls` / 重复 fingerprint 自动 abort
- Databases 侧栏（schema / 表浏览）
- Local FS 路径沙箱硬校验（拦截越界绝对路径）
- bash 危险命令 allowlist / denylist（Host 层）
- 写库 skill（需单独审批与审计）

---

*文档版本：v0.1 · 对应 BlueLamp 内置 piFlow MVP · 2026-08*
