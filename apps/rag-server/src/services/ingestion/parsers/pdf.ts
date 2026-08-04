import { readFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import { PdfDocument } from 'pdf-oxide';
import type { ParserBackend } from '@bluelamp/core';
import {
  PDF_OCR_DPI,
  PDF_OCR_ENABLED,
  PDF_OCR_MIN_CHARS,
} from '../config.js';
import { ocrPageImage } from './pp-ocr.js';

export interface PdfPageText {
  page: number;
  text: string;
}

export interface ParsePdfResult {
  pages: PdfPageText[];
  backend: ParserBackend;
}

function significantCharCount(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function extractTextLayerPages(filePath: string): { pages: PdfPageText[]; pageCount: number } {
  const doc = PdfDocument.open(filePath);
  try {
    const pageCount = doc.pageCount();
    const pages: PdfPageText[] = [];
    for (let i = 0; i < pageCount; i++) {
      const text = doc.toMarkdown(i).trim();
      if (text) {
        pages.push({ page: i + 1, text });
      }
    }
    return { pages, pageCount };
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
  const scale = dpi / 72;
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false,
    true,
  );
  return {
    width: pixmap.getWidth(),
    height: pixmap.getHeight(),
    data: new Uint8Array(pixmap.getPixels()),
  };
}

/**
 * Prefer pdf-oxide text layer; OCR pages that look empty/scanned (PP-OCR ONNX).
 */
export async function parsePdfForIngest(filePath: string): Promise<ParsePdfResult> {
  const { pages: textPages, pageCount } = extractTextLayerPages(filePath);
  const byPage = new Map(textPages.map((p) => [p.page, p.text]));

  const weakPages: number[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const text = byPage.get(page) ?? '';
    if (significantCharCount(text) < PDF_OCR_MIN_CHARS) {
      weakPages.push(page);
    }
  }

  if (!PDF_OCR_ENABLED || weakPages.length === 0) {
    return {
      pages: textPages,
      backend: 'pdf-oxide',
    };
  }

  console.log(
    `[ingest] pdf-oxide weak/empty on ${weakPages.length}/${pageCount} pages → PP-OCR @ ${PDF_OCR_DPI} DPI`,
  );

  const buf = await readFile(filePath);
  const ocrDoc = mupdf.Document.openDocument(buf, 'application/pdf');
  let ocrUsed = 0;

  for (let wi = 0; wi < weakPages.length; wi++) {
    const page = weakPages[wi];
    const t0 = Date.now();
    try {
      const image = renderPageRgb(ocrDoc, page - 1, PDF_OCR_DPI);
      const text = await ocrPageImage(image);
      if (significantCharCount(text) > 0) {
        byPage.set(page, text);
        ocrUsed += 1;
        console.log(
          `[ingest] PP-OCR page ${page}/${pageCount}: ${significantCharCount(text)} chars in ${Date.now() - t0}ms`,
        );
      } else {
        console.log(`[ingest] PP-OCR page ${page}/${pageCount}: no text (${Date.now() - t0}ms)`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ingest] PP-OCR page ${page} failed: ${message}`);
    }
    // OCR inference is CPU-heavy; yield so /health and UI proxy stay alive.
    await new Promise<void>((r) => setImmediate(r));
  }

  const pages: PdfPageText[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const text = byPage.get(page)?.trim();
    if (text) pages.push({ page, text });
  }

  const backend: ParserBackend = ocrUsed > 0 ? 'pp-ocr' : 'pdf-oxide';

  return { pages, backend };
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
