import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { Citation, ChunkMetadata } from '@bluelamp/core';
import { truncateCitationQuote } from '@bluelamp/core';
import {
  countChunks,
  getChunkById,
  listDocuments,
  type StoredChunkRow,
} from '../../db.js';
import { searchChunks, type ScoredChunk } from '../retrieval/retriever.js';

export const KB_TOOL_NAMES = ['kb_list_documents', 'kb_search', 'kb_get_chunk'] as const;

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}

function parseMeta(raw: string): ChunkMetadata {
  try {
    return JSON.parse(raw) as ChunkMetadata;
  } catch {
    return { charOffset: 0 };
  }
}

function hitToCitation(chunk: ScoredChunk, index: number): Citation {
  return {
    sourceId: `[${index + 1}]`,
    quote: truncateCitationQuote(chunk.content, 280),
    documentId: chunk.documentId,
    documentTitle: chunk.documentTitle,
    sourcePath: chunk.sourcePath,
    chunkId: chunk.chunkId,
    page: chunk.metadata.page,
    heading: chunk.metadata.heading,
  };
}

function rowToCitation(row: StoredChunkRow, index: number): Citation {
  const meta = parseMeta(row.metadata_json);
  return {
    sourceId: `[${index + 1}]`,
    quote: truncateCitationQuote(row.content, 280),
    documentId: row.document_id,
    documentTitle: row.document_title,
    sourcePath: row.source_path,
    chunkId: row.id,
    page: meta.page,
    heading: meta.heading,
  };
}

function emptyKb() {
  return textResult(
    'Knowledge base has no indexed chunks. Import a folder in Knowledge Base, then retry.',
    { ready: false, chunkCount: 0 },
  );
}

export type CreateKbToolsOptions = {
  /** Called when kb_search / kb_get_chunk produce citations for this turn. */
  onCitations?: (citations: Citation[]) => void;
};

export function createKbTools(options: CreateKbToolsOptions = {}) {
  const kbListDocuments = defineTool({
    name: 'kb_list_documents',
    label: 'List KB Documents',
    description:
      'List documents in the local knowledge base. Optional keyword filters title or path.',
    parameters: Type.Object({
      keyword: Type.Optional(
        Type.String({ description: 'Filter substring for title or source path' }),
      ),
    }),
    execute: async (_id, params) => {
      const keyword = params.keyword?.trim().toLowerCase() ?? '';
      let docs = listDocuments().map((d) => ({
        id: d.id,
        title: d.title,
        sourcePath: d.source_path,
        chunkCount: d.chunk_count,
        mimeType: d.mime_type,
        updatedAt: d.updated_at,
      }));
      if (keyword) {
        docs = docs.filter(
          (d) =>
            d.title.toLowerCase().includes(keyword) ||
            d.sourcePath.toLowerCase().includes(keyword),
        );
      }
      if (docs.length === 0 && countChunks() === 0) return emptyKb();
      return textResult(JSON.stringify(docs, null, 2), {
        documents: docs,
        count: docs.length,
      });
    },
  });

  const kbSearch = defineTool({
    name: 'kb_search',
    label: 'Search Knowledge Base',
    description:
      'Vector-search imported documents. Returns ranked hits with citation fields (sourceId, quote, path, page, chunkId).',
    parameters: Type.Object({
      query: Type.String({ description: 'Natural-language search query' }),
      topK: Type.Optional(Type.Number({ description: 'Max hits, default 5' })),
      documentId: Type.Optional(
        Type.String({ description: 'Optional: restrict to one document id' }),
      ),
    }),
    execute: async (_id, params) => {
      if (countChunks() === 0) return emptyKb();
      const query = params.query?.trim();
      if (!query) {
        return textResult('query is required', { error: 'missing_query' });
      }
      const topK = Math.min(20, Math.max(1, Math.floor(params.topK ?? 5)));
      const { chunks } = await searchChunks(query, topK * 3);
      const filtered = params.documentId?.trim()
        ? chunks.filter((c) => c.documentId === params.documentId!.trim())
        : chunks;
      const hits = filtered.slice(0, topK);
      const citations = hits.map((c, i) => hitToCitation(c, i));
      if (citations.length > 0) options.onCitations?.(citations);

      const payload = hits.map((c, i) => ({
        sourceId: citations[i]!.sourceId,
        chunkId: c.chunkId,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        sourcePath: c.sourcePath,
        page: c.metadata.page ?? null,
        heading: c.metadata.heading ?? null,
        score: Number(c.score.toFixed(4)),
        excerpt: citations[i]!.quote,
      }));

      return textResult(JSON.stringify(payload, null, 2), {
        hits: payload,
        citations,
        count: payload.length,
      });
    },
  });

  const kbGetChunk = defineTool({
    name: 'kb_get_chunk',
    label: 'Get KB Chunk',
    description: 'Fetch full text for a knowledge-base chunk by chunkId (from kb_search).',
    parameters: Type.Object({
      chunkId: Type.String({ description: 'Chunk id from kb_search' }),
    }),
    execute: async (_id, params) => {
      const chunkId = params.chunkId?.trim();
      if (!chunkId) {
        return textResult('chunkId is required', { error: 'missing_chunkId' });
      }
      const row = getChunkById(chunkId);
      if (!row) {
        return textResult(`Chunk not found: ${chunkId}`, { error: 'not_found' });
      }
      const citation = rowToCitation(row, 0);
      options.onCitations?.([citation]);
      const meta = parseMeta(row.metadata_json);
      const payload = {
        sourceId: citation.sourceId,
        chunkId: row.id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        sourcePath: row.source_path,
        page: meta.page ?? null,
        heading: meta.heading ?? null,
        content: row.content,
        citation,
      };
      return textResult(JSON.stringify(payload, null, 2), { ...payload, citations: [citation] });
    },
  });

  return [kbListDocuments, kbSearch, kbGetChunk];
}
