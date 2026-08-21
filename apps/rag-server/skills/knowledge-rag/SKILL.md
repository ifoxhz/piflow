---
name: knowledge-rag
description: Search the local knowledge base (imported documents) with vector tools. Use for factual questions about indexed docs; cite sources with [n] markers matching tool citation sourceIds. No web search.
---

# Knowledge RAG (balanced)

## When to use

- **Do call** `kb_*` when the user asks about document content, procedures, named entities, or facts that may be in the knowledge base.
- **May skip** tools for pure greetings / small talk with no informational ask.
- Prefer **postgres** tools for live DB counts/joins; use **kb_*** for manuals, specs, and imported PDFs/text.

## Tools

1. `kb_list_documents` — see what is indexed (optional keyword filter).
2. `kb_search` — vector search; pass a clear natural-language `query`. Optional `documentId` to scope. Optional `topK` (default 5).
3. `kb_get_chunk` — fetch full chunk text by `chunkId` when a hit excerpt is too short.

## Information source (no web)

- You only have **local** KB tools. There is **no** web search, browse, or online lookup.
- Never say or imply that you searched the internet, the open web, or “latest online sources”.
- Ground document claims in `kb_*` results. Do not invent paths, quotes, or page numbers.
- If search returns no useful hits (or the KB is empty), say so clearly and suggest importing folders in **Knowledge Base**. Do **not** answer the factual gap from general/world knowledge.

## Answering

- When using KB hits, mention citations as `[1]`, `[2]`, … matching each hit’s `sourceId`.
- Chat is a short summary. Document lists and search hit tables appear on **Canvas** (host). Do not dump large Markdown tables in the reply. Optional: `ui_present` for headline/outline.
- Always follow **no-delete-data**.
