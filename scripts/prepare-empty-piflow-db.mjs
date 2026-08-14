/**
 * Build an empty piflow.db (schema only, no documents / sessions / vectors)
 * for Windows portable first-run seeding.
 *
 * Usage:
 *   node scripts/prepare-empty-piflow-db.mjs [outPath]
 *
 * Default out: apps/desktop/src-tauri/resources/seed/piflow.db
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(
  ROOT,
  'apps/desktop/src-tauri/resources/seed/piflow.db',
);

const require = createRequire(path.join(ROOT, 'apps/rag-server/package.json'));
const Database = require('better-sqlite3');

const outPath = path.resolve(process.argv[2] || DEFAULT_OUT);
mkdirSync(path.dirname(outPath), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  const p = `${outPath}${suffix}`;
  if (existsSync(p)) rmSync(p, { force: true });
}

const db = new Database(outPath);
db.pragma('journal_mode = DELETE'); // single-file seed; no WAL sidecar in the package
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    parser_backend TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_page_count INTEGER,
    indexed_page_count INTEGER NOT NULL DEFAULT 0,
    ingest_complete INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    embedding BLOB NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

  CREATE TABLE IF NOT EXISTS document_pages (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (document_id, page)
  );

  CREATE INDEX IF NOT EXISTS idx_document_pages_doc ON document_pages(document_id);

  CREATE TABLE IF NOT EXISTS piflow_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_piflow_sessions_updated ON piflow_sessions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS piflow_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    citations_json TEXT,
    FOREIGN KEY(session_id) REFERENCES piflow_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_piflow_messages_session ON piflow_messages(session_id, created_at);
`);

const counts = db
  .prepare(
    `SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM chunks) AS chunks,
      (SELECT COUNT(*) FROM piflow_sessions) AS sessions`,
  )
  .get();
db.close();

if (counts.documents !== 0 || counts.chunks !== 0 || counts.sessions !== 0) {
  throw new Error(`seed db is not empty: ${JSON.stringify(counts)}`);
}

console.log(`[seed-db] wrote empty ${outPath}`);
