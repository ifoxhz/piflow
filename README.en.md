# BlueLamp

[English](README.en.md) | [简体中文](README.md)

**A fully local RAG desktop app** — traceable answers · privacy-first · lightweight

BlueLamp is a retrieval-augmented generation (RAG) desktop application: import local documents to build a knowledge base, then ask questions in natural language. Parsing, embedding, retrieval, and inference all run on your machine (or a server you specify) — documents and conversations never leave your control. Generated answers come with source citations you can trace back to the exact document and passage.

UI design preview: [docs/index.png](docs/index.png)

## Features

- **Traceable answers**: every answer ships with citations and verbatim excerpts, clickable down to the source document and chunk — keeping hallucination in check
- **Privacy-first**: documents, vector index, and chat history live in a local SQLite database; no cloud dependency
- **Folder-level ingestion**: pick a directory and import it recursively; a background job does the work with real-time progress in the activity log
- **Smart retrieval pipeline (reRAG)**: intent template routing → LLM-generated structured retrieval plan → multi-way dense retrieval merged with dynamic top-K per intent, with multi-turn coreference resolution
- **Multi-format parsing**: PDF (pdf-oxide / mupdf), Markdown, TXT, HTML; scanned PDFs automatically routed to PaddleOCR
- **Pluggable generation backends**: local GGUF inference (node-llama-cpp), remote Ollama (e.g. a LAN GPU server), or Pleias-RAG-1B
- **Automatic model management**: manifest-driven model registry; missing models download automatically from the hf-mirror.com mirror, with forced re-download support

## Architecture

A Tauri 2 + Node Sidecar dual-process design: Tauri is only a thin UI shell, while all RAG inference and native modules run in a separate Node process. Frontend and backend talk over localhost HTTP / SSE.

```
┌────────────────────────────────────────────────────┐
│         Tauri WebView (React + TypeScript)          │
│   Chat · Knowledge base · Citations · Activity log  │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / SSE (localhost)
┌──────────────────────▼─────────────────────────────┐
│            Node RAG Sidecar (apps/rag-server)       │
│                                                     │
│  Ingestion ──► parser routing (native / pdf-oxide   │
│              / OCR) ──► structure-aware chunking    │
│              ──► BGE-M3 embeddings                  │
│                                                     │
│  Chat ──► template router ──► planning LLM ──►      │
│        multi-way dense retrieval ──► answer LLM     │
│        (local GGUF / Ollama / Pleias)               │
│                                                     │
│  SQLite (metadata + vectors) · model cache · files  │
└─────────────────────────────────────────────────────┘
```

See [docs/architecture.md](docs/architecture.md) and [docs/reRAG.md](docs/reRAG.md) for full design documents (in Chinese).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2 (Rust handles only windowing & sidecar lifecycle) |
| Frontend | React 19 + TypeScript + Vite |
| RAG backend | Node.js + Hono (HTTP / SSE) |
| Embedding | BGE-M3 (Xenova ONNX, `@huggingface/transformers`, worker thread) |
| Generation | Qwen2.5-3B-Instruct GGUF (node-llama-cpp) / Ollama / Pleias-RAG-1B |
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
| `BLUELAMP_USE_LOCAL_LLM` | Set `true` for local GGUF generation (no Ollama needed) |
| `BLUELAMP_OLLAMA_URL` / `BLUELAMP_OLLAMA_MODEL` | Remote Ollama endpoint and model |

## macOS Packaging

Day-to-day development happens on WSL; once features stabilize, package on macOS (requires the [Rust + Tauri prerequisites](https://tauri.app/start/prerequisites/)):

```bash
cd apps/desktop && pnpm tauri dev    # verify the desktop shell
cd apps/desktop && pnpm tauri build  # produce the .app bundle
```

## Project Structure

```
apps/desktop/     Tauri + React desktop UI
apps/rag-server/  Node RAG HTTP service (Hono)
packages/core/    Shared types, chunker, and RAG core logic
models/           Model manifest and local cache
scripts/          Model download and service management scripts
docs/             Architecture docs and ADRs (in Chinese)
```

## Documentation

> Design documents are written in Chinese.

- [Architecture](docs/architecture.md) — system design, modules, platform strategy
- [reRAG: structured pre-retrieval planning](docs/reRAG.md) — template routing + retrieval planning pipeline
- [Retrieval quality upgrade](docs/retrieval-quality-upgrade.md) — hybrid retrieval & RRF fusion (proposal)
- [Knowledge base folder import](docs/knowledge-base-import.md)
- [WSL development guide](docs/development-wsl.md)
- ADRs: [001 Tauri + Sidecar](docs/adr/001-tauri-sidecar.md) · [002 Document parsing](docs/adr/002-document-parsing.md) · [003 Model management](docs/adr/003-model-management.md) · [004 WSL dev / macOS release](docs/adr/004-wsl-dev-macos-release.md)

## Roadmap

- **Phase 1 — MVP (in progress)**: monorepo scaffolding, RAG sidecar, document ingestion, chat with citations, model management; then macOS packaging with signing & notarization
- **Phase 2 — Experience**: Docling for complex documents, hybrid retrieval (BM25 + dense RRF), model download UI, reasoning-trace visualization
- **Phase 3 — Windows**: sidecar Windows binaries, installer, CUDA detection
- **Phase 4 — Advanced**: multiple isolated knowledge bases, multi-turn context management, pluggable document sources

## License

[MIT](LICENSE)
