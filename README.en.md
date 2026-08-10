# piFlow

[English](README.en.md) | [简体中文](README.md)

**A fully local RAG desktop app** — traceable answers · privacy-first · lightweight

piFlow is a retrieval-augmented generation (RAG) desktop application: import local documents to build a knowledge base, then ask questions in natural language. Parsing, embedding, retrieval, and inference all run on your machine (or a server you specify) — documents and conversations never leave your control. Generated answers come with source citations you can trace back to the exact document and passage.

The main chat is driven by the **piFlow Agent** (Pi harness): the knowledge base is exposed as Skill / Tools (`kb_*`), with optional Postgres read-only and local filesystem Skills.

UI design preview: [docs/index.png](docs/index.png)

## Features

- **Traceable answers**: every answer ships with citations and verbatim excerpts, clickable down to the source document and chunk — keeping hallucination in check
- **Privacy-first**: documents, vector index, and chat history live in a local SQLite database; no cloud dependency
- **Folder-level ingestion**: pick a directory and import it recursively; a background job does the work with real-time progress in the activity log
- **Smart retrieval pipeline (reRAG)**: intent template routing → LLM-generated structured retrieval plan → multi-way dense retrieval merged with dynamic top-K per intent, with multi-turn coreference resolution
- **Multi-format parsing**: PDF (pdf-oxide / mupdf), Markdown, TXT, HTML; scanned PDFs automatically routed to PaddleOCR
- **Pluggable generation backends**: local GGUF inference (node-llama-cpp), remote Ollama (e.g. a LAN GPU server), DeepSeek, or Pleias-RAG-1B
- **Automatic model management**: manifest-driven model registry; missing models download automatically from the hf-mirror.com mirror, with forced re-download support
- **piFlow Agent**: primary chat entry; toggleable Knowledge RAG / Postgres read-only / Local FS Skills (Pi harness + SSE)

## Architecture

A Tauri 2 + Node Sidecar dual-process design: Tauri is only a thin UI shell, while all RAG inference and native modules run in a separate Node process. Frontend and backend talk over localhost HTTP / SSE.

```
┌────────────────────────────────────────────────────┐
│         Tauri WebView (React + TypeScript)          │
│   Knowledge · piFlow (main chat) · Citations · Settings │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / SSE (localhost)
┌──────────────────────▼─────────────────────────────┐
│            Node Sidecar (apps/rag-server)           │
│                                                     │
│  RAG: ingest → parse → chunk → BGE-M3 → retrieve    │
│  piFlow: Pi Agent + Skills (KB / Postgres / FS)     │
│                                                     │
│  SQLite · pg-actions · model cache · files          │
└─────────────────────────────────────────────────────┘
```

Portable app data directory: `%APPDATA%\piFlow\` (dev default: repo `.data\`).

See [docs/architecture.md](docs/architecture.md) ([English](docs/architecture.en.md)), [docs/piflow.md](docs/piflow.md), and [docs/reRAG.md](docs/reRAG.md) for full design documents (piflow/reRAG currently Chinese).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust handles only windowing & sidecar lifecycle) |
| Frontend | React 19 + TypeScript + Vite |
| RAG backend | Node.js + Hono (HTTP / SSE) |
| Embedding | BGE-M3 (Xenova ONNX, `@huggingface/transformers`, worker thread) |
| Generation | Qwen2.5-3B-Instruct GGUF (node-llama-cpp) / Ollama / DeepSeek / Pleias-RAG-1B |
| Storage | better-sqlite3 (metadata + vectors, cosine similarity search) |
| Parsing | pdf-oxide · mupdf · PaddleOCR (scanned documents) |
| Package management | pnpm workspaces (monorepo) |

## Getting Started (WSL / Linux)

Prerequisites: Node.js ≥ 20, pnpm 10. Keep the repo on the Linux filesystem (`~/`), not `/mnt/c/`.

```bash
pnpm install
cp .env.example .env   # adjust as needed

# Download models (China mirror)
export HF_ENDPOINT=https://hf-mirror.com
pnpm models:ensure

# Terminal 1: RAG backend (http://127.0.0.1:3847)
pnpm dev:server

# Terminal 2: frontend (open http://localhost:1420 in a browser)
pnpm dev:ui

# Or run both in parallel
pnpm dev
```

## Models

Model registry: [models/manifest.json](models/manifest.json); details: [models/README.md](models/README.md).

| Purpose | Model | Size |
|---------|-------|------|
| Embedding | Xenova/bge-m3 (ONNX fp16) | ~1.1 GB |
| Local generation | Qwen2.5-3B-Instruct GGUF (q4_k_m) | ~2 GB |
| Generation (optional) | Pleias-RAG-1B GGUF | ~2.4 GB |
| OCR | PaddleOCR | bundled |

**Recommended hardware**: 16 GB RAM, 10 GB free disk space.

## Configuration

Key environment variables (full list in [.env.example](.env.example)):

| Variable | Description |
|----------|-------------|
| `HF_ENDPOINT` | Hugging Face mirror, defaults to `https://hf-mirror.com` |
| `BLUELAMP_RAG_PORT` | RAG server port, defaults to `3847` |
| `BLUELAMP_MODELS_DIR` | Model directory, defaults to `models/` in the repo |
| `BLUELAMP_DATA_DIR` | Data directory; unset → repo `.data/` in dev; packaged app injects `%APPDATA%\piFlow\` |
| `BLUELAMP_USE_LOCAL_LLM` | Set `true` for local GGUF generation (no Ollama needed) |
| `BLUELAMP_OLLAMA_URL` / `BLUELAMP_OLLAMA_MODEL` | Remote Ollama endpoint and model |

## Windows portable package

Build on a **native Windows** machine (not WSL-only). Because the bundled BGE-M3 model is large, the release is a **portable folder + zip**, not NSIS/MSI.

### Prerequisites

- Node.js ≥ 20, pnpm 10, Git
- Rust (`x86_64-pc-windows-msvc`) + Visual Studio Build Tools (Desktop development with C++)
- WebView2 Runtime (usually already on Win10/11)
- Embedding model downloaded: `pnpm models:ensure` (local BGE-M3 required)

Full checklist: [docs/development-windows.md](docs/development-windows.md).

### One-shot build

From the repo root (PowerShell):

```powershell
pnpm install
$env:HF_ENDPOINT="https://hf-mirror.com"
pnpm models:ensure
pnpm build:windows
```

`pnpm build:windows` runs:

1. `bundle:windows-sidecar` — pack Node runtime, `rag-server`, and models into Tauri resources  
2. `tauri build --no-bundle` — compile `piFlow.exe`  
3. `package:windows-portable` — assemble the portable folder and zip  

### Artifacts

| Path | Description |
|------|-------------|
| `dist-windows/piFlow/` | Runnable folder |
| `dist-windows/piFlow-<version>-portable.zip` | Same contents as a zip |

Unzip and run **`piFlow.exe`**. First launch extracts the backend under `%APPDATA%\piFlow\sidecar\`; user data / DB / logs live in `%APPDATA%\piFlow\`.

Configure Ollama or DeepSeek in Settings; import and retrieval work without a generation backend.

## Project Structure

```
apps/desktop/     Tauri + React desktop UI
apps/rag-server/  Node HTTP service (RAG + piFlow, Hono)
packages/core/    Shared types, chunker, and RAG core logic
packages/pg-actions/  piFlow Postgres read-only tools
models/           Model manifest and local cache
scripts/          Model download and service management scripts
docs/             Architecture docs, user manual, and ADRs (in Chinese)
```

## Documentation

> Design documents are written in Chinese.

- [Architecture](docs/architecture.md) ([English](docs/architecture.en.md)) — system design, modules, platform strategy
- [piFlow design](docs/piflow.md) — Agent / Skill / SSE / information-source policy
- [User manual (zh)](docs/user-manual.zh.md) — install, RAG, piFlow, settings, FAQ
- [reRAG: structured pre-retrieval planning](docs/reRAG.md) — template routing + retrieval planning pipeline
- [Retrieval quality upgrade](docs/retrieval-quality-upgrade.md) — hybrid retrieval & RRF fusion (proposal)
- [Knowledge base folder import](docs/knowledge-base-import.md)
- [WSL development guide](docs/development-wsl.md)
- [Windows build & run checklist](docs/development-windows.md)
- ADRs: [001 Tauri + Sidecar](docs/adr/001-tauri-sidecar.md) · [002 Document parsing](docs/adr/002-document-parsing.md) · [003 Model management](docs/adr/003-model-management.md) · [004 WSL dev / Windows release](docs/adr/004-wsl-dev-windows-release.md)

## Roadmap

- **Phase 1 — MVP (in progress)**: monorepo scaffolding, RAG sidecar, document ingestion, chat with citations, model management; Windows portable package (`pnpm build:windows`)
- **Phase 2 — Experience**: Docling for complex documents, hybrid retrieval (BM25 + dense RRF), model download UI, reasoning-trace visualization
- **Phase 3 — Windows hardening**: package size optimization, optional OCR, CUDA detection
- **Phase 4 — Advanced**: multiple isolated knowledge bases, multi-turn context management, pluggable document sources

## License

[MIT](LICENSE)
