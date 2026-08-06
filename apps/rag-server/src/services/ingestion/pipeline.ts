import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chunkText, extractMarkdownHeading, type ChunkMetadata } from '@bluelamp/core';
import type { IngestFileTask, ParserBackend } from '@bluelamp/core';
import {
  deleteDocumentChunks,
  findDocumentByPath,
  insertChunk,
  insertDocument,
} from '../../db.js';
import { EMBED_FLUSH_SIZE } from './config.js';
import { embedTexts } from './embedder.js';
import { parseNativeFile, titleFromPath } from './parsers/native.js';
import { parsePdfForIngest } from './parsers/pdf.js';

export interface ProcessFileResult {
  status: 'done' | 'skipped' | 'failed';
  chunkCount?: number;
  skipReason?: string;
  error?: string;
}

export interface ProcessFileOptions {
  /**
   * Called after parse (0/total), during embed (live worker ticks),
   * and after each chunk is inserted.
   */
  onChunkProgress?: (done: number, total: number) => void;
}

interface IndexedPiece {
  content: string;
  metadata: ChunkMetadata;
}

function chunkNativeText(text: string, backend: ParserBackend): IndexedPiece[] {
  const pieces = chunkText(text);
  return pieces.map((content, index) => ({
    content,
    metadata: {
      charOffset: index,
      parserBackend: backend,
      heading: extractMarkdownHeading(content),
    },
  }));
}

function chunkPdfPages(
  pages: Array<{ page: number; text: string }>,
  backend: ParserBackend,
): IndexedPiece[] {
  const indexed: IndexedPiece[] = [];
  for (const { page, text } of pages) {
    const pieces = chunkText(text);
    for (const content of pieces) {
      indexed.push({
        content,
        metadata: {
          charOffset: indexed.length,
          parserBackend: backend,
          page,
          heading: extractMarkdownHeading(content),
        },
      });
    }
  }
  return indexed;
}

export async function processFile(
  file: IngestFileTask,
  options: ProcessFileOptions = {},
): Promise<ProcessFileResult> {
  if (file.status === 'skipped') {
    return { status: 'skipped', skipReason: file.skipReason ?? 'skipped' };
  }

  try {
    const st = await stat(file.absolutePath);
    const mtimeMs = Math.trunc(st.mtimeMs);
    const existing = findDocumentByPath(file.absolutePath);

    if (existing && Math.trunc(existing.mtime_ms) === mtimeMs) {
      return { status: 'skipped', skipReason: 'unchanged' };
    }

    const ext = path.extname(file.absolutePath).toLowerCase();
    let indexed: IndexedPiece[];
    let backend: ParserBackend = 'native';

    if (ext === '.pdf') {
      const parsed = await parsePdfForIngest(file.absolutePath);
      backend = parsed.backend;
      indexed = chunkPdfPages(parsed.pages, backend);
    } else {
      const text = await parseNativeFile(file.absolutePath);
      indexed = chunkNativeText(text, backend);
    }

    if (indexed.length === 0) {
      return { status: 'skipped', skipReason: 'empty content' };
    }

    const fileLabel = path.basename(file.absolutePath);
    const flushSize = Math.max(1, EMBED_FLUSH_SIZE);
    console.log(
      `[ingest] ${fileLabel}: ${indexed.length} chunks → embed+index (flush every ${flushSize})`,
    );
    options.onChunkProgress?.(0, indexed.length);

    const documentId = existing?.id ?? randomUUID();
    const now = new Date().toISOString();

    if (existing) {
      deleteDocumentChunks(documentId);
    }

    insertDocument({
      id: documentId,
      title: titleFromPath(file.absolutePath),
      source_path: file.absolutePath,
      mime_type: file.mimeType,
      mtime_ms: mtimeMs,
      parser_backend: backend,
      chunk_count: indexed.length,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    // Embed+write in small flushes so vectors/text can be GC'd (avoids RSS climb on 1k+ chunks).
    for (let offset = 0; offset < indexed.length; offset += flushSize) {
      const end = Math.min(offset + flushSize, indexed.length);
      const slice = indexed.slice(offset, end);
      const embeddings = await embedTexts(
        slice.map((piece) => piece.content),
        {
          label: fileLabel,
          progressBase: offset,
          progressTotal: indexed.length,
          onProgress: (done, total) => options.onChunkProgress?.(done, total),
        },
      );

      for (let j = 0; j < slice.length; j++) {
        const { content, metadata } = slice[j];
        const embedding = embeddings[j];
        const buf = Buffer.from(
          embedding.buffer,
          embedding.byteOffset,
          embedding.byteLength,
        );
        insertChunk(randomUUID(), documentId, content, JSON.stringify(metadata), buf);
        // Release chunk text + vector refs for this flush.
        slice[j].content = '';
        indexed[offset + j].content = '';
      }
      // Confirm indexed count after flush (may already match live embed ticks).
      options.onChunkProgress?.(end, indexed.length);
      embeddings.length = 0;

      console.log(`[ingest] indexed ${end}/${indexed.length} chunks (${fileLabel})`);
      await new Promise<void>((r) => setImmediate(r));
    }

    return { status: 'done', chunkCount: indexed.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: message };
  }
}
