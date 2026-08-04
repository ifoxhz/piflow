# BlueLamp

**完全本地运行的 RAG 桌面应用** — 可溯源回答 · 隐私优先 · 轻量部署

BlueLamp 是一款检索增强生成（RAG）桌面应用：导入本地文档构建知识库，然后用自然语言提问。所有解析、向量化、检索与推理均在本机（或你指定的内网服务器）完成，文档与对话不上传云端；生成答案附带原文引用，可逐条溯源。

UI 设计参考：[docs/index.png](docs/index.png)

## 核心特性

- **可溯源回答**：答案附带来源引用与原文摘录，点击可定位到具体文档与段落，降低幻觉风险
- **隐私优先**：文档、向量索引、会话历史全部存储在本地（SQLite），无云端依赖
- **目录级知识库导入**：选择文件夹递归导入，后台 Job 异步执行，活动日志实时展示进度
- **智能检索管线（reRAG）**：意图模板路由 → LLM 生成结构化检索计划 → 多路 dense 检索合并 → 按意图动态 topK，支持多轮对话指代消解
- **多格式文档解析**：PDF（pdf-oxide / mupdf）、Markdown、TXT、HTML；扫描件 PDF 自动走 PaddleOCR
- **可插拔生成后端**：本地 GGUF 推理（node-llama-cpp）、远程 Ollama（可利用内网 GPU 服务器）、Pleias-RAG-1B（可选）
- **模型自动管理**：模型清单驱动，缺失自动从国内镜像（hf-mirror.com）下载，支持强制重下

## 系统架构

Tauri 2 + Node Sidecar 双进程架构：Tauri 只做轻量 UI 壳，全部 RAG 推理与原生模块运行在独立的 Node 进程中，前后端通过 localhost HTTP / SSE 通信。

```
┌────────────────────────────────────────────────────┐
│         Tauri WebView（React + TypeScript）          │
│   对话界面 · 知识库管理 · 引用溯源 · 活动日志           │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / SSE (localhost)
┌──────────────────────▼─────────────────────────────┐
│            Node RAG Sidecar（apps/rag-server）       │
│                                                      │
│  Ingestion ──► 解析路由（native / pdf-oxide / OCR）    │
│              ──► 结构感知分块 ──► BGE-M3 嵌入          │
│                                                      │
│  Chat ──► 模板路由 ──► 检索规划 LLM ──► 多路 dense 检索 │
│        ──► 答案生成（local GGUF / Ollama / Pleias）    │
│                                                      │
│  SQLite（元数据 + 向量）· 模型缓存 · 原始文档             │
└──────────────────────────────────────────────────────┘
```

详细设计见 [docs/architecture.md](docs/architecture.md) 与 [docs/reRAG.md](docs/reRAG.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri 2（Rust 仅负责窗口与 Sidecar 生命周期） |
| 前端 | React 19 + TypeScript + Vite |
| RAG 后端 | Node.js + Hono（HTTP / SSE） |
| 嵌入模型 | BGE-M3（Xenova ONNX，`@huggingface/transformers`，Worker Thread） |
| 生成模型 | Qwen2.5-3B-Instruct GGUF（node-llama-cpp）/ Ollama / Pleias-RAG-1B |
| 存储 | better-sqlite3（元数据 + 向量，余弦相似度检索） |
| 文档解析 | pdf-oxide · mupdf · PaddleOCR（扫描件） |
| 包管理 | pnpm workspaces（monorepo） |

## 快速开始（WSL / Linux）

前置要求：Node.js ≥ 20，pnpm 10。建议仓库放在 Linux 文件系统（`~/`）下，避免 `/mnt/c/`。

```bash
pnpm install
cp .env.example .env   # 按需修改

# 下载模型（国内镜像）
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure

# 终端 1：RAG 后端（http://127.0.0.1:3847）
pnpm dev:server

# 终端 2：前端（浏览器打开 http://localhost:1420）
pnpm dev:ui

# 或一键并行
pnpm dev
```

## 模型

模型清单见 [models/manifest.json](models/manifest.json)，说明见 [models/README.md](models/README.md)：

| 用途 | 模型 | 体积 |
|------|------|------|
| 嵌入 | Xenova/bge-m3（ONNX fp16） | ~1.1 GB |
| 本地生成 | Qwen2.5-3B-Instruct GGUF（q4_k_m） | ~2 GB |
| 生成（可选） | Pleias-RAG-1B GGUF | ~2.4 GB |
| OCR | PaddleOCR | 随包下载 |

**推荐配置**：16 GB RAM，10 GB 可用磁盘。

## 配置

关键环境变量（完整列表见 [.env.example](.env.example)）：

| 变量 | 说明 |
|------|------|
| `HF_ENDPOINT` | Hugging Face 镜像，默认 `https://hf-mirror.com` |
| `BLUELAMP_RAG_PORT` | RAG 服务端口，默认 `3847` |
| `BLUELAMP_MODELS_DIR` | 模型目录，默认仓库内 `models/` |
| `BLUELAMP_USE_LOCAL_LLM` | `true` 启用本地 GGUF 生成（无需 Ollama） |
| `BLUELAMP_OLLAMA_URL` / `BLUELAMP_OLLAMA_MODEL` | 远程 Ollama 服务地址与模型 |

## macOS 打包

日常开发在 WSL 完成，功能稳定后在 macOS 打包发布（需 [Rust + Tauri 前置依赖](https://tauri.app/start/prerequisites/)）：

```bash
cd apps/desktop && pnpm tauri dev    # 验证桌面壳
cd apps/desktop && pnpm tauri build  # 生成 .app
```

## 项目结构

```
apps/desktop/     Tauri + React 桌面 UI
apps/rag-server/  Node RAG HTTP 服务（Hono）
packages/core/    共享类型、分块器与 RAG 核心逻辑
models/           模型清单与本地缓存
scripts/          模型下载、服务管理脚本
docs/             架构设计文档与 ADR
```

## 文档

- [架构设计](docs/architecture.md) — 系统架构、模块设计、平台策略
- [reRAG：检索前结构化规划](docs/reRAG.md) — 模板路由 + 检索规划管线
- [检索质量升级设计](docs/retrieval-quality-upgrade.md) — Hybrid Retrieval 与 RRF 融合（提案）
- [知识库目录导入设计](docs/knowledge-base-import.md)
- [WSL 开发指南](docs/development-wsl.md)
- ADR：[001 Tauri + Sidecar](docs/adr/001-tauri-sidecar.md) · [002 文档解析](docs/adr/002-document-parsing.md) · [003 模型管理](docs/adr/003-model-management.md) · [004 WSL 开发 / macOS 发布](docs/adr/004-wsl-dev-macos-release.md)

## 路线图

- **Phase 1 — MVP（进行中）**：monorepo 脚手架、RAG Sidecar、文档导入、对话与引用、模型管理；随后 macOS 打包与签名公证
- **Phase 2 — 体验增强**：Docling 复杂文档解析、混合检索（BM25 + dense RRF）、模型下载 UI、推理轨迹可视化
- **Phase 3 — Windows 适配**：Sidecar Windows 二进制、安装包、CUDA 探测
- **Phase 4 — 高级能力**：多知识库隔离、多轮上下文管理、插件化文档源

## License

[MIT](LICENSE)
