import { PdfDocument } from 'pdf-oxide';

export interface PdfPageText {
  page: number;
  text: string;
}

export async function parsePdfPages(filePath: string): Promise<PdfPageText[]> {
  const doc = PdfDocument.open(filePath);
  try {
    const pages: PdfPageText[] = [];
    const count = doc.pageCount();
    for (let i = 0; i < count; i++) {
      const text = doc.toMarkdown(i).trim();
      if (text) {
        pages.push({ page: i + 1, text });
      }
    }
    return pages;
  } finally {
    doc.close();
  }
}

/** @deprecated Prefer {@link parsePdfPages} for per-page metadata. */
export async function parsePdfFile(filePath: string): Promise<string> {
  const pages = await parsePdfPages(filePath);
  return pages.map((p) => p.text).join('\n\n');
}
