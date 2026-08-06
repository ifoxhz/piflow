import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Rough seconds to embed one chunk on CPU BGE-M3 (warm).
 * Calibrated from local runs (~2.0–2.5 s/chunk on typical Windows CPU).
 */
const EMBED_SEC_PER_CHUNK_LOW = 1.8;
const EMBED_SEC_PER_CHUNK_HIGH = 2.8;
/** First embed batch often pays model load. */
const EMBED_COLD_START_SEC = 25;
/** Text-PDF: parse is usually fast; keep a small cushion per page. */
const PARSE_SEC_PER_PAGE = 0.05;
const PARSE_BASE_SEC = 2;
/** Heuristic chunks from page count when we cannot measure text yet. */
const CHUNKS_PER_PAGE = 0.95;
const CHARS_PER_CHUNK = 1600;

export interface IngestTimeEstimate {
  pages?: number;
  estimatedChunks: number;
  secondsLow: number;
  secondsHigh: number;
  /** Human label, e.g. "约 3–6 分钟" */
  label: string;
}

function formatEtaMinutes(secLow: number, secHigh: number): string {
  const lo = Math.max(1, Math.ceil(secLow / 60));
  const hi = Math.max(lo, Math.ceil(secHigh / 60));
  if (lo === hi) return `约 ${lo} 分钟`;
  return `约 ${lo}–${hi} 分钟`;
}

function estimateFromChunks(chunks: number, pages?: number): IngestTimeEstimate {
  const parseSec = PARSE_BASE_SEC + (pages ?? chunks) * PARSE_SEC_PER_PAGE;
  const embedLow = EMBED_COLD_START_SEC + chunks * EMBED_SEC_PER_CHUNK_LOW;
  const embedHigh = EMBED_COLD_START_SEC + chunks * EMBED_SEC_PER_CHUNK_HIGH;
  const secondsLow = Math.round(parseSec + embedLow);
  const secondsHigh = Math.round(parseSec + embedHigh);
  return {
    pages,
    estimatedChunks: chunks,
    secondsLow,
    secondsHigh,
    label: formatEtaMinutes(secondsLow, secondsHigh),
  };
}

async function pdfPageCount(filePath: string): Promise<number | undefined> {
  try {
    const mupdf = await import('mupdf');
    const buf = await readFile(filePath);
    const doc = mupdf.Document.openDocument(buf, 'application/pdf');
    return doc.countPages();
  } catch {
    return undefined;
  }
}

/**
 * Cheap pre-ingest estimate so the UI can show an expectation before parsing finishes.
 * Text-layer PDFs: pages → chunks; plain text: file size → chunks.
 */
export async function estimateIngestFile(
  filePath: string,
  mimeType: string,
): Promise<IngestTimeEstimate> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.pdf' || mimeType.includes('pdf')) {
      const pages = await pdfPageCount(filePath);
      if (pages != null && pages > 0) {
        const chunks = Math.max(1, Math.round(pages * CHUNKS_PER_PAGE));
        return estimateFromChunks(chunks, pages);
      }
      const size = (await stat(filePath)).size;
      // ~50KB/page rough fallback when page count fails
      const pagesGuess = Math.max(1, Math.round(size / 50_000));
      return estimateFromChunks(Math.round(pagesGuess * CHUNKS_PER_PAGE), pagesGuess);
    }

    const size = (await stat(filePath)).size;
    // UTF-8 text ≈ 1 byte/char for ASCII-heavy; Chinese denser — use 0.7× as compromise
    const chars = Math.round(size * 0.7);
    const chunks = Math.max(1, Math.round(chars / CHARS_PER_CHUNK));
    return estimateFromChunks(chunks);
  } catch {
    return estimateFromChunks(50);
  }
}

/** Remaining embed time once chunk totals are known (parse already done). */
export function estimateRemainingEmbed(
  chunksDone: number,
  chunksTotal: number,
  embedStartedAtMs?: number,
): { secondsLow: number; secondsHigh: number; label: string } {
  const remaining = Math.max(0, chunksTotal - chunksDone);
  if (remaining === 0) {
    return { secondsLow: 0, secondsHigh: 0, label: '即将完成' };
  }

  let perChunk = (EMBED_SEC_PER_CHUNK_LOW + EMBED_SEC_PER_CHUNK_HIGH) / 2;
  if (embedStartedAtMs != null && chunksDone > 0) {
    const elapsed = (Date.now() - embedStartedAtMs) / 1000;
    perChunk = Math.max(0.5, elapsed / chunksDone);
  }

  const secondsLow = Math.round(remaining * perChunk * 0.85);
  const secondsHigh = Math.round(remaining * perChunk * 1.2);
  const lo = Math.min(secondsLow, secondsHigh);
  const hi = Math.max(secondsLow, secondsHigh);
  return {
    secondsLow: lo,
    secondsHigh: hi,
    label: hi < 60 ? `剩余约 ${Math.max(1, hi)} 秒` : formatEtaMinutes(lo, hi).replace(/^约/, '剩余约'),
  };
}
