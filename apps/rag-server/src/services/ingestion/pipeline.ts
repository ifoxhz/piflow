import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chunkText, extractMarkdownHeading, type ChunkMetadata } from '@bluelamp/core';
import type { IngestFileTask, ParserBackend } from '@bluelamp/core';
import {
  countDocumentChunks,
  deleteChunksForPage,
  deleteDocumentChunks,
  deletePagesBeyond,
  findDocumentByPath,
  insertChunk,
  insertDocument,
  listDocumentPages,
  upsertDocumentPage,
  type StoredDocument,
} from '../../db.js';
import { EMBED_FLUSH_SIZE, PAGE_WINDOW_SIZE } from './config.js';
import { embedTexts } from './embedder.js';
import { parseNativeFile, titleFromPath } from './parsers/native.js';
import {
  getPdfPageCount,
  hashPageContent,
  parsePdfPageWindow,
} from './parsers/pdf.js';

export interface ProcessFileResult {
  status: 'done' | 'skipped' | 'failed';
  chunkCount?: number;
  skipReason?: string;
  error?: string;
}

export interface ProcessFileProgress {
  chunksDone: number;
  chunksTotal: number;
  pagesDone?: number;
  pagesTotal?: number;
  reusedPages?: number;
  status?: 'parsing' | 'embedding' | 'indexing';
}

export interface ProcessFileOptions {
  onProgress?: (progress: ProcessFileProgress) => void;
  /** @deprecated use onProgress */
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

function chunkPdfPageText(
  page: number,
  text: string,
  backend: ParserBackend,
  charOffsetStart: number,
): IndexedPiece[] {
  const pieces = chunkText(text);
  return pieces.map((content, i) => ({
    content,
    metadata: {
      charOffset: charOffsetStart + i,
      parserBackend: backend,
      page,
      heading: extractMarkdownHeading(content),
    },
  }));
}

function emitProgress(
  options: ProcessFileOptions,
  progress: ProcessFileProgress,
): void {
  options.onProgress?.(progress);
  options.onChunkProgress?.(progress.chunksDone, progress.chunksTotal);
}

async function embedAndInsertPieces(
  documentId: string,
  pieces: IndexedPiece[],
  fileLabel: string,
  progressBase: number,
  progressTotal: number,
  options: ProcessFileOptions,
  pagesDone?: number,
  pagesTotal?: number,
  reusedPages?: number,
): Promise<void> {
  const flushSize = Math.max(1, EMBED_FLUSH_SIZE);
  for (let offset = 0; offset < pieces.length; offset += flushSize) {
    const end = Math.min(offset + flushSize, pieces.length);
    const slice = pieces.slice(offset, end);
    const embeddings = await embedTexts(
      slice.map((piece) => piece.content),
      {
        label: fileLabel,
        progressBase: progressBase + offset,
        progressTotal,
        onProgress: (done, total) =>
          emitProgress(options, {
            chunksDone: done,
            chunksTotal: total,
            pagesDone,
            pagesTotal,
            reusedPages,
            status: 'embedding',
          }),
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
      slice[j].content = '';
      pieces[offset + j].content = '';
    }
    embeddings.length = 0;
    emitProgress(options, {
      chunksDone: progressBase + end,
      chunksTotal: progressTotal,
      pagesDone,
      pagesTotal,
      reusedPages,
      status: 'indexing',
    });
    await new Promise<void>((r) => setImmediate(r));
  }
}

function upsertDoc(partial: StoredDocument): void {
  insertDocument(partial);
}

async function processPdfFile(
  file: IngestFileTask,
  options: ProcessFileOptions,
  existing: StoredDocument | undefined,
  mtimeMs: number,
): Promise<ProcessFileResult> {
  const fileLabel = path.basename(file.absolutePath);
  const pageCount = getPdfPageCount(file.absolutePath);
  if (pageCount <= 0) {
    return { status: 'skipped', skipReason: 'empty content' };
  }

  const existingPages = existing ? listDocumentPages(existing.id) : [];
  const hashByPage = new Map(existingPages.map((p) => [p.page, p]));

  const complete =
    existing != null &&
    existing.ingest_complete === 1 &&
    Math.trunc(existing.mtime_ms) === mtimeMs &&
    existing.source_page_count === pageCount &&
    existing.indexed_page_count === pageCount &&
    existingPages.length === pageCount;

  if (complete) {
    return { status: 'skipped', skipReason: 'unchanged' };
  }

  const documentId = existing?.id ?? randomUUID();
  const now = new Date().toISOString();
  const windowSize = PAGE_WINDOW_SIZE;

  upsertDoc({
    id: documentId,
    title: titleFromPath(file.absolutePath),
    source_path: file.absolutePath,
    mime_type: file.mimeType,
    mtime_ms: mtimeMs,
    parser_backend: existing?.parser_backend ?? 'pdf-oxide',
    chunk_count: existing?.chunk_count ?? 0,
    source_page_count: pageCount,
    indexed_page_count: existing?.indexed_page_count ?? 0,
    ingest_complete: 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  let chunksDone = 0;
  let reusedPages = 0;
  let pagesDone = 0;
  let sawOcr = false;
  // Soft total: refine as we learn; start from prior chunk_count or page heuristic.
  let chunksTotal = Math.max(
    existing?.chunk_count ?? 0,
    pageCount,
    1,
  );

  console.log(
    `[ingest] ${fileLabel}: PDF ${pageCount} pages → window=${windowSize}` +
      (existing ? ' (incremental fingerprint)' : ''),
  );

  emitProgress(options, {
    chunksDone: 0,
    chunksTotal,
    pagesDone: 0,
    pagesTotal: pageCount,
    reusedPages: 0,
    status: 'parsing',
  });

  for (let from = 1; from <= pageCount; from += windowSize) {
    const to = Math.min(pageCount, from + windowSize - 1);
    emitProgress(options, {
      chunksDone,
      chunksTotal,
      pagesDone,
      pagesTotal: pageCount,
      reusedPages,
      status: 'parsing',
    });

    const parsed = await parsePdfPageWindow(file.absolutePath, from, to);
    if (parsed.backend === 'pp-ocr') sawOcr = true;

    for (const { page, text } of parsed.pages) {
      const contentHash = hashPageContent(text);
      const prev = hashByPage.get(page);
      if (prev && prev.content_hash === contentHash && prev.chunk_count >= 0) {
        // Fingerprint match: reuse vectors (including empty pages with 0 chunks).
        reusedPages += 1;
        pagesDone += 1;
        chunksDone += prev.chunk_count;
        chunksTotal = Math.max(chunksTotal, chunksDone + (pageCount - pagesDone));
        emitProgress(options, {
          chunksDone,
          chunksTotal,
          pagesDone,
          pagesTotal: pageCount,
          reusedPages,
          status: 'indexing',
        });
        continue;
      }

      deleteChunksForPage(documentId, page);

      if (!text.trim()) {
        upsertDocumentPage({
          document_id: documentId,
          page,
          content_hash: contentHash,
          chunk_count: 0,
        });
        hashByPage.set(page, {
          document_id: documentId,
          page,
          content_hash: contentHash,
          chunk_count: 0,
        });
        pagesDone += 1;
        emitProgress(options, {
          chunksDone,
          chunksTotal,
          pagesDone,
          pagesTotal: pageCount,
          reusedPages,
          status: 'indexing',
        });
        continue;
      }

      const pieces = chunkPdfPageText(page, text, parsed.backend, chunksDone);
      const pageChunkCount = pieces.length;
      chunksTotal = Math.max(
        chunksTotal,
        chunksDone + pageChunkCount + Math.max(0, pageCount - pagesDone - 1),
      );

      if (pageChunkCount > 0) {
        await embedAndInsertPieces(
          documentId,
          pieces,
          fileLabel,
          chunksDone,
          chunksTotal,
          options,
          pagesDone,
          pageCount,
          reusedPages,
        );
      }

      chunksDone += pageChunkCount;
      pagesDone += 1;
      upsertDocumentPage({
        document_id: documentId,
        page,
        content_hash: contentHash,
        chunk_count: pageChunkCount,
      });
      hashByPage.set(page, {
        document_id: documentId,
        page,
        content_hash: contentHash,
        chunk_count: pageChunkCount,
      });

      upsertDoc({
        id: documentId,
        title: titleFromPath(file.absolutePath),
        source_path: file.absolutePath,
        mime_type: file.mimeType,
        mtime_ms: mtimeMs,
        parser_backend: sawOcr ? 'pp-ocr' : 'pdf-oxide',
        chunk_count: countDocumentChunks(documentId),
        source_page_count: pageCount,
        indexed_page_count: pagesDone,
        ingest_complete: 0,
        created_at: existing?.created_at ?? now,
        updated_at: new Date().toISOString(),
      });

      emitProgress(options, {
        chunksDone,
        chunksTotal: Math.max(chunksTotal, chunksDone),
        pagesDone,
        pagesTotal: pageCount,
        reusedPages,
        status: 'indexing',
      });
      console.log(
        `[ingest] ${fileLabel}: pages ${pagesDone}/${pageCount}` +
          ` chunks=${chunksDone} reused=${reusedPages}`,
      );
    }
  }

  deletePagesBeyond(documentId, pageCount);
  const finalChunks = countDocumentChunks(documentId);
  const indexedPages = listDocumentPages(documentId).filter((p) => p.page <= pageCount).length;
  const ingestComplete = indexedPages >= pageCount ? 1 : 0;

  upsertDoc({
    id: documentId,
    title: titleFromPath(file.absolutePath),
    source_path: file.absolutePath,
    mime_type: file.mimeType,
    mtime_ms: mtimeMs,
    parser_backend: sawOcr ? 'pp-ocr' : 'pdf-oxide',
    chunk_count: finalChunks,
    source_page_count: pageCount,
    indexed_page_count: indexedPages,
    ingest_complete: ingestComplete,
    created_at: existing?.created_at ?? now,
    updated_at: new Date().toISOString(),
  });

  emitProgress(options, {
    chunksDone: finalChunks,
    chunksTotal: finalChunks,
    pagesDone: indexedPages,
    pagesTotal: pageCount,
    reusedPages,
    status: 'indexing',
  });

  console.log(
    `[ingest] ${fileLabel}: done pages=${indexedPages}/${pageCount}` +
      ` chunks=${finalChunks} reused=${reusedPages} complete=${ingestComplete}`,
  );

  return { status: 'done', chunkCount: finalChunks };
}

async function processNativeFile(
  file: IngestFileTask,
  options: ProcessFileOptions,
  existing: StoredDocument | undefined,
  mtimeMs: number,
): Promise<ProcessFileResult> {
  if (
    existing &&
    Math.trunc(existing.mtime_ms) === mtimeMs &&
    existing.ingest_complete === 1 &&
    existing.chunk_count > 0
  ) {
    return { status: 'skipped', skipReason: 'unchanged' };
  }

  const text = await parseNativeFile(file.absolutePath);
  const backend: ParserBackend = 'native';
  const indexed = chunkNativeText(text, backend);
  if (indexed.length === 0) {
    return { status: 'skipped', skipReason: 'empty content' };
  }

  const fileLabel = path.basename(file.absolutePath);
  console.log(
    `[ingest] ${fileLabel}: ${indexed.length} chunks → embed+index (flush every ${EMBED_FLUSH_SIZE})`,
  );
  emitProgress(options, {
    chunksDone: 0,
    chunksTotal: indexed.length,
    status: 'embedding',
  });

  const documentId = existing?.id ?? randomUUID();
  const now = new Date().toISOString();

  if (existing) {
    deleteDocumentChunks(documentId);
  }

  upsertDoc({
    id: documentId,
    title: titleFromPath(file.absolutePath),
    source_path: file.absolutePath,
    mime_type: file.mimeType,
    mtime_ms: mtimeMs,
    parser_backend: backend,
    chunk_count: indexed.length,
    source_page_count: null,
    indexed_page_count: 0,
    ingest_complete: 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });

  await embedAndInsertPieces(
    documentId,
    indexed,
    fileLabel,
    0,
    indexed.length,
    options,
  );

  upsertDoc({
    id: documentId,
    title: titleFromPath(file.absolutePath),
    source_path: file.absolutePath,
    mime_type: file.mimeType,
    mtime_ms: mtimeMs,
    parser_backend: backend,
    chunk_count: indexed.length,
    source_page_count: null,
    indexed_page_count: 0,
    ingest_complete: 1,
    created_at: existing?.created_at ?? now,
    updated_at: new Date().toISOString(),
  });

  return { status: 'done', chunkCount: indexed.length };
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
    const ext = path.extname(file.absolutePath).toLowerCase();

    if (ext === '.pdf') {
      return processPdfFile(file, options, existing, mtimeMs);
    }
    return processNativeFile(file, options, existing, mtimeMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: message };
  }
}
