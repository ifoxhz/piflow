import { createHash } from 'node:crypto';
import * as mupdf from 'mupdf';
import { PdfDocument } from 'pdf-oxide';
import type { ParserBackend } from '@bluelamp/core';
import {
  PDF_OCR_DPI,
  PDF_OCR_ENABLED,
  PDF_OCR_MIN_CHARS,
} from '../config.js';

export interface PdfPageText {
  page: number;
  text: string;
}

export interface ParsePdfResult {
  pages: PdfPageText[];
  backend: ParserBackend;
}

export function hashPageContent(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function significantCharCount(text: string): number {
  return text.replace(/\s+/g, '').length;
}

export function getPdfPageCount(filePath: string): number {
  const doc = PdfDocument.open(filePath);
  try {
    return doc.pageCount();
  } finally {
    doc.close();
  }
}

function extractTextLayerRange(
  filePath: string,
  fromPage: number,
  toPage: number,
): Map<number, string> {
  const doc = PdfDocument.open(filePath);
  try {
    const pageCount = doc.pageCount();
    const out = new Map<number, string>();
    const start = Math.max(1, fromPage);
    const end = Math.min(pageCount, toPage);
    for (let page = start; page <= end; page++) {
      const text = doc.toMarkdown(page - 1).trim();
      if (text) out.set(page, text);
    }
    return out;
  } finally {
    doc.close();
  }
}

function renderPageRgb(
  doc: InstanceType<typeof mupdf.Document>,
  pageIndex: number,
  dpi: number,
): { width: number; height: number; data: Uint8Array } {
  const page = doc.loadPage(pageIndex);
  try {
    const scale = dpi / 72;
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    try {
      return {
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
        data: new Uint8Array(pixmap.getPixels()),
      };
    } finally {
      // mupdf WASM/native may expose destroy; ignore if absent
      const destroyable = pixmap as { destroy?: () => void };
      destroyable.destroy?.();
    }
  } finally {
    const destroyable = page as { destroy?: () => void };
    destroyable.destroy?.();
  }
}

/**
 * Parse a page window [fromPage, toPage] (1-based inclusive).
 * Text layer first; OCR only weak pages inside this window (isolated child).
 */
export async function parsePdfPageWindow(
  filePath: string,
  fromPage: number,
  toPage: number,
): Promise<ParsePdfResult> {
  const byPage = extractTextLayerRange(filePath, fromPage, toPage);
  const weakPages: number[] = [];
  for (let page = fromPage; page <= toPage; page++) {
    const text = byPage.get(page) ?? '';
    if (significantCharCount(text) < PDF_OCR_MIN_CHARS) {
      weakPages.push(page);
    }
  }

  let ocrUsed = 0;
  if (PDF_OCR_ENABLED && weakPages.length > 0) {
    console.log(
      `[ingest] pages ${fromPage}-${toPage}: pdf-oxide weak on ${weakPages.length} → PP-OCR @ ${PDF_OCR_DPI} DPI (child)`,
    );
    const { ocrPageImageIsolated } = await import('./pp-ocr-runner.js');
    // Open by path — avoid holding a full-file Buffer on the main heap.
    const ocrDoc = mupdf.Document.openDocument(filePath);

    try {
      for (const page of weakPages) {
        const t0 = Date.now();
        try {
          const image = renderPageRgb(ocrDoc, page - 1, PDF_OCR_DPI);
          const text = await ocrPageImageIsolated(image);
          if (significantCharCount(text) > 0) {
            byPage.set(page, text);
            ocrUsed += 1;
            console.log(
              `[ingest] PP-OCR page ${page}: ${significantCharCount(text)} chars in ${Date.now() - t0}ms`,
            );
          } else {
            console.log(`[ingest] PP-OCR page ${page}: no text (${Date.now() - t0}ms)`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[ingest] PP-OCR page ${page} failed (continuing): ${message}`,
          );
        }
        await new Promise<void>((r) => setImmediate(r));
      }
    } finally {
      const destroyable = ocrDoc as { destroy?: () => void; close?: () => void };
      destroyable.destroy?.();
      destroyable.close?.();
    }
  }

  const pages: PdfPageText[] = [];
  for (let page = fromPage; page <= toPage; page++) {
    pages.push({ page, text: (byPage.get(page) ?? '').trim() });
  }

  return {
    pages,
    backend: ocrUsed > 0 ? 'pp-ocr' : 'pdf-oxide',
  };
}

/**
 * Prefer pdf-oxide text layer; OCR pages that look empty/scanned (PP-OCR ONNX).
 * Full-document helper (non-windowed callers / tests).
 */
export async function parsePdfForIngest(filePath: string): Promise<ParsePdfResult> {
  const pageCount = getPdfPageCount(filePath);
  if (pageCount <= 0) return { pages: [], backend: 'pdf-oxide' };
  return parsePdfPageWindow(filePath, 1, pageCount);
}

export async function parsePdfPages(filePath: string): Promise<PdfPageText[]> {
  const { pages } = await parsePdfForIngest(filePath);
  return pages;
}

/** @deprecated Prefer {@link parsePdfPages} for per-page metadata. */
export async function parsePdfFile(filePath: string): Promise<string> {
  const pages = await parsePdfPages(filePath);
  return pages.map((p) => p.text).join('\n\n');
}
