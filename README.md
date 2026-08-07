# BlueLamp

**全本地 RAG 桌面应用** · 答案可追溯 · 隐私优先 · 轻量

[English](README.en.md) | 简体中文

BlueLamp 是一款检索增强生成（RAG）桌面应用：导入本地文档构建知识库，然后用自然语言提问。解析、嵌入、检索、推理全部在你的机器上（或你指定的服务器上）运行——文档与对话始终不离开你的掌控。生成的答案附带来源引用，可追溯到具体的文档与段落。

UI 设计预览：[docs/index.png](docs/index.png)

## 特性

- **答案可追溯**：每条答案都附带引用与原文摘录，可点击定位到源文档和具体片段——让幻觉无所遁形
- **隐私优先**：文档、向量索引、聊天记录都存储在本地 SQLite 数据库中，无任何云端依赖
- **目录级导入**：选择目录即可递归导入，后台任务静默执行，活动日志实时显示进度
- **智能检索流水线（reRAG）**：意图模板路由 → LLM 生成结构化检索计划 → 多路密集检索按意图动态 top-K 合并，并支持多轮共指消解
- **多格式解析**：PDF（pdf-oxide / mupdf）、Markdown、TXT、HTML；扫描版 PDF 自动路由到 PaddleOCR
- **可插拔生成后端**：本地 GGUF 推理（node-llama-cpp）、远程 Ollama（如局域网 GPU 服务器）、或 Pleias-RAG-1B
- **自动模型管理**：基于清单的模型注册表；缺失模型自动从 hf-mirror.com 镜像下载，并支持强制重新下载
- **piFlow Agent**：侧栏独立入口；可开关的 Postgres 只读 / 本地文件 Skill（Pi harness + SSE）

## 架构

采用 Tauri 2 + Node Sidecar 双进程设计：Tauri 仅作为薄 UI 外壳，所有 RAG 推理与原生模块运行在独立的 Node 进程中。前后端通过 localhost HTTP / SSE 通信。

```
┌────────────────────────────────────────────────────┐
│         Tauri WebView (React + TypeScript)          │
│   聊天 · 知识库 · piFlow · 引用 · 设置               │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / SSE (localhost)
┌──────────────────────▼─────────────────────────────┐
│            Node Sidecar (apps/rag-server)           │
│                                                     │
│  RAG：导入 → 解析 → 分块 → BGE-M3 → 检索 → 生成     │
│  piFlow：Pi Agent + Skills（Postgres / Local FS）   │
│                                                     │
│  SQLite · pg-actions · 模型缓存 · 文件               │
└─────────────────────────────────────────────────────┘
```

完整设计文档见 [docs/architecture.md](docs/architecture.md)、[docs/piflow.md](docs/piflow.md) 与 [docs/reRAG.md](docs/reRAG.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面外壳 | Tauri 2（Rust 仅负责窗口与 sidecar 生命周期） |
| 前端 | React 19 + TypeScript + Vite |
| RAG 后端 | Node.js + Hono（HTTP / SSE） |
| 嵌入 | BGE-M3（Xenova ONNX，`@huggingface/transformers`，worker 线程） |
| 生成 | Qwen2.5-3B-Instruct GGUF（node-llama-cpp）/ Ollama / Pleias-RAG-1B |
| 存储 | better-sqlite3（元数据 + 向量，余弦相似度检索） |
| 解析 | pdf-oxide · mupdf · PaddleOCR（扫描文档） |
| 包管理 | pnpm workspaces（monorepo） |

## 快速开始（WSL / Linux）

前置条件：Node.js ≥ 20、pnpm 10。请将仓库放在 Linux 文件系统（`~/`）下，而非 `/mnt/c/`。

```bash
pnpm install
cp .env.example .env   # 按需调整

# 下载模型（国内镜像）
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure

# 终端 1：RAG 后端（http://127.0.0.1:3847）
pnpm dev:server

# 终端 2：前端（在浏览器打开 http://localhost:1420）
pnpm dev:ui

# 或并行启动两者
pnpm dev
```

## 模型

模型注册表：[models/manifest.json](models/manifest.json)；详情：[models/README.md](models/README.md)。

| 用途 | 模型 | 大小 |
|------|------|------|
| 嵌入 | Xenova/bge-m3（ONNX fp16） | ~1.1 GB |
| 本地生成 | Qwen2.5-3B-Instruct GGUF（q4_k_m） | ~2 GB |
| 生成（可选） | Pleias-RAG-1B GGUF | ~2.4 GB |
| OCR | PaddleOCR | 随包附带 |

**推荐配置**：16 GB 内存、10 GB 可用磁盘空间。

## 配置

关键环境变量（完整列表见 [.env.example](.env.example)）：

| 变量 | 说明 |
|------|------|
| `HF_ENDPOINT` | Hugging Face 镜像，默认 `https://hf-mirror.com` |
| `BLUELAMP_RAG_PORT` | RAG 服务端口，默认 `3847` |
| `BLUELAMP_MODELS_DIR` | 模型目录，默认仓库内 `models/` |
| `BLUELAMP_USE_LOCAL_LLM` | 设为 `true` 启用本地 GGUF 生成（无需 Ollama） |
| `BLUELAMP_OLLAMA_URL` / `BLUELAMP_OLLAMA_MODEL` | 远程 Ollama 端点与模型 |

## macOS 打包

日常开发在 WSL 上进行；功能稳定后在 macOS 上打包（需安装 [Rust + Tauri 前置依赖](https://tauri.app/start/prerequisites/)）：

```bash
cd apps/desktop && pnpm tauri dev    # 验证桌面外壳
cd apps/desktop && pnpm tauri build  # 产出 .app 包
```

## 项目结构

```
apps/desktop/     Tauri + React 桌面 UI
apps/rag-server/  Node HTTP 服务（RAG + piFlow，Hono）
packages/core/    共享类型、分块器与 RAG 核心逻辑
packages/pg-actions/  piFlow Postgres 只读 tools
models/           模型清单与本地缓存
scripts/          模型下载与服务管理脚本
docs/             架构文档、用户手册与 ADR
```

## 文档

- [架构设计](docs/architecture.md) — 系统设计、模块划分、平台策略
- [piFlow 设计](docs/piflow.md) — Agent / Skill / SSE / Postgres & Local FS
- [用户手册（中文）](docs/user-manual.zh.md) — 安装、RAG、piFlow、设置与 FAQ
- [reRAG：结构化预检索规划](docs/reRAG.md) — 模板路由 + 检索规划流水线
- [检索质量升级](docs/retrieval-quality-upgrade.md) — 混合检索与 RRF 融合（提案）
- [知识库目录导入](docs/knowledge-base-import.md)
- [WSL 开发指南](docs/development-wsl.md)
- [Windows 编译与运行清单](docs/development-windows.md)
- ADR：[001 Tauri + Sidecar](docs/adr/001-tauri-sidecar.md) · [002 文档解析](docs/adr/002-document-parsing.md) · [003 模型管理](docs/adr/003-model-management.md) · [004 WSL 开发 / macOS 发布](docs/adr/004-wsl-dev-macos-release.md)

## 路线图

- **阶段 1 — MVP（进行中）**：monorepo 脚手架、RAG sidecar、文档导入、带引用的聊天、模型管理；随后完成 macOS 签名与公证打包
- **阶段 2 — 体验**：Docling 处理复杂文档、混合检索（BM25 + dense RRF）、模型下载 UI、推理轨迹可视化
- **阶段 3 — Windows**：sidecar Windows 二进制、安装包、CUDA 检测
- **阶段 4 — 进阶**：多个隔离的知识库、多轮上下文管理、可插拔文档源

## 许可证

[MIT](LICENSE)
