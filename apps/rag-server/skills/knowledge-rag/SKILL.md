---
name: knowledge-rag
description: Search the local knowledge base (imported documents) with vector tools. Use for factual questions about indexed docs; cite sources with [n] markers matching tool citation sourceIds.
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

## Answering

- Ground claims in tool results. Do not invent document paths or quotes.
- When using KB hits, mention citations as `[1]`, `[2]`, … matching each hit’s `sourceId`.
- If the knowledge base is empty / tools say not ready, tell the user to import folders in **Knowledge Base**.
- Always follow **no-delete-data**.
