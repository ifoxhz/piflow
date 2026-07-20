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
import { embedTexts } from './embedder.js';
import { parseNativeFile, titleFromPath } from './parsers/native.js';
import { parsePdfPages } from './parsers/pdf.js';

export interface ProcessFileResult {
  status: 'done' | 'skipped' | 'failed';
  chunkCount?: number;
  skipReason?: string;
  error?: string;
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

export async function processFile(file: IngestFileTask): Promise<ProcessFileResult> {
  if (file.status === 'skipped') {
    return { status: 'skipped', skipReason: file.skipReason ?? 'skipped' };
  }

  try {
    const st = await stat(file.absolutePath);
    const mtimeMs = st.mtimeMs;
    const existing = findDocumentByPath(file.absolutePath);

    if (existing && existing.mtime_ms === mtimeMs) {
      return { status: 'skipped', skipReason: 'unchanged' };
    }

    const ext = path.extname(file.absolutePath).toLowerCase();
    let indexed: IndexedPiece[];
    let backend: ParserBackend = 'native';

    if (ext === '.pdf') {
      backend = 'pdf-oxide';
      const pages = await parsePdfPages(file.absolutePath);
      indexed = chunkPdfPages(pages, backend);
    } else {
      const text = await parseNativeFile(file.absolutePath);
      indexed = chunkNativeText(text, backend);
    }

    if (indexed.length === 0) {
      return { status: 'skipped', skipReason: 'empty content' };
    }

    const embeddings = await embedTexts(indexed.map((piece) => piece.content));
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

    for (let i = 0; i < indexed.length; i++) {
      const { content, metadata } = indexed[i];
      const embedding = embeddings[i];
      const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      insertChunk(randomUUID(), documentId, content, JSON.stringify(metadata), buf);
    }

    return { status: 'done', chunkCount: indexed.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: message };
  }
}
