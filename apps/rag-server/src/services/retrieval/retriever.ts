import type { Citation, ChunkMetadata } from '@bluelamp/core';
import { truncateCitationQuote } from '@bluelamp/core';
import { listSearchableChunks, type StoredChunkRow } from '../../db.js';
import { elapsedMs, nowMs } from '../chat/llm-query-log.js';
import { embedQuery } from '../ingestion/embedder.js';

const DEFAULT_TOP_K = 5;
const CITATION_QUOTE_MAX_CHARS = 280;

export interface RetrieveTiming {
  chunks: ScoredChunk[];
  embedMs: number;
  scoreMs: number;
}

export interface ScoredChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourcePath: string;
  content: string;
  score: number;
  metadata: ChunkMetadata;
}

function blobToFloat32(blob: Buffer): Float32Array {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

function parseChunkMetadata(raw: string): ChunkMetadata {
  try {
    return JSON.parse(raw) as ChunkMetadata;
  } catch {
    return { charOffset: 0 };
  }
}

function toScored(row: StoredChunkRow, score: number): ScoredChunk {
  return {
    chunkId: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    sourcePath: row.source_path,
    content: row.content,
    score,
    metadata: parseChunkMetadata(row.metadata_json),
  };
}

export async function searchChunks(
  query: string,
  topK = DEFAULT_TOP_K,
): Promise<RetrieveTiming> {
  const rows = listSearchableChunks();
  if (rows.length === 0) return { chunks: [], embedMs: 0, scoreMs: 0 };

  const embedStarted = nowMs();
  const queryVec = await embedQuery(query);
  const embedMs = elapsedMs(embedStarted);

  const scoreStarted = nowMs();
  const scored = rows.map((row) => ({
    row,
    score: cosineSimilarity(queryVec, blobToFloat32(row.embedding)),
  }));

  scored.sort((a, b) => b.score - a.score);
  const chunks = scored.slice(0, topK).map(({ row, score }) => toScored(row, score));
  const scoreMs = elapsedMs(scoreStarted);
  return { chunks, embedMs, scoreMs };
}

/**
 * Multi-query dense search: each query retrieves `perQueryK`, then merge by
 * chunkId keeping the max score, return global topK.
 */
export async function searchWithQueries(
  queries: string[],
  topK = DEFAULT_TOP_K,
  perQueryK = DEFAULT_TOP_K,
): Promise<RetrieveTiming> {
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (unique.length === 0) return { chunks: [], embedMs: 0, scoreMs: 0 };

  const merged = new Map<string, ScoredChunk>();
  let embedMs = 0;
  let scoreMs = 0;
  for (const q of unique) {
    const hits = await searchChunks(q, perQueryK);
    embedMs += hits.embedMs;
    scoreMs += hits.scoreMs;
    for (const hit of hits.chunks) {
      const prev = merged.get(hit.chunkId);
      if (!prev || hit.score > prev.score) merged.set(hit.chunkId, hit);
    }
  }

  const chunks = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  return { chunks, embedMs, scoreMs };
}

export function toCitations(chunks: ScoredChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    sourceId: `[${i + 1}]`,
    quote: truncateCitationQuote(c.content, CITATION_QUOTE_MAX_CHARS),
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    sourcePath: c.sourcePath,
    chunkId: c.chunkId,
    page: c.metadata.page,
    heading: c.metadata.heading,
  }));
}
