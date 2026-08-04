export const SUPPORTED_EXT = new Set(['.pdf', '.md', '.markdown', '.txt', '.html', '.htm']);

export const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '__pycache__',
  'models',
  'dist',
  'target',
  '.data',
]);

export const MAX_FILES_PER_JOB = Number(process.env.BLUELAMP_INGEST_MAX_FILES ?? 500);
export const MAX_FILE_BYTES = Number(
  process.env.BLUELAMP_INGEST_MAX_FILE_BYTES ?? 300 * 1024 * 1024,
);

export const EMBED_BATCH_SIZE = 8;
/**
 * How many chunks to embed+insert before dropping vectors from memory.
 * Keeps peak RSS flat on large OCR'd books.
 */
export const EMBED_FLUSH_SIZE = Number(process.env.BLUELAMP_EMBED_FLUSH_SIZE ?? 32);

/** When pdf-oxide extracts too little text, fall back to Node PP-OCR (ONNX). */
export const PDF_OCR_ENABLED = process.env.BLUELAMP_PDF_OCR !== '0';
/** Minimum non-whitespace chars from text layer before skipping OCR on that page. */
export const PDF_OCR_MIN_CHARS = Number(process.env.BLUELAMP_PDF_OCR_MIN_CHARS ?? 40);
/** Render DPI for OCR (higher = slower / more accurate). */
export const PDF_OCR_DPI = Number(process.env.BLUELAMP_PDF_OCR_DPI ?? 120);
