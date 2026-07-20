export interface ChunkerOptions {
  maxChars?: number;
  overlap?: number;
}

const DEFAULT_MAX_CHARS = 1800;
const DEFAULT_OVERLAP = 200;

/** Rough character-based chunking (≈512 tokens). Splits on paragraph boundaries when possible. */
export function chunkText(text: string, options: ChunkerOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer = '';

  const flush = () => {
    const piece = buffer.trim();
    if (piece) chunks.push(piece);
    buffer = '';
  };

  for (const para of paragraphs) {
    const block = para.trim();
    if (!block) continue;

    if (block.length > maxChars) {
      flush();
      let start = 0;
      while (start < block.length) {
        const end = Math.min(start + maxChars, block.length);
        chunks.push(block.slice(start, end).trim());
        if (end >= block.length) break;
        start = end - overlap;
      }
      continue;
    }

    if ((buffer + '\n\n' + block).trim().length > maxChars) {
      flush();
    }
    buffer = buffer ? `${buffer}\n\n${block}` : block;
  }

  flush();
  return chunks;
}
