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
  process.env.BLUELAMP_INGEST_MAX_FILE_BYTES ?? 50 * 1024 * 1024,
);

export const EMBED_BATCH_SIZE = 8;
