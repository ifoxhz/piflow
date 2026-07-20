import type { Citation, ChunkMetadata } from '@bluelamp/core';
import { truncateCitationQuote } from '@bluelamp/core';
import { listSearchableChunks, type StoredChunkRow } from '../../db.js';
import { embedQuery } from '../ingestion/embedder.js';

const DEFAULT_TOP_K = 5;
const CITATION_QUOTE_MAX_CHARS = 280;

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

export async function searchChunks(query: string, topK = DEFAULT_TOP_K): Promise<ScoredChunk[]> {
  const rows = listSearchableChunks();
  if (rows.length === 0) return [];

  const queryVec = await embedQuery(query);
  const scored = rows.map((row) => ({
    row,
    score: cosineSimilarity(queryVec, blobToFloat32(row.embedding)),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ row, score }) => toScored(row, score));
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
