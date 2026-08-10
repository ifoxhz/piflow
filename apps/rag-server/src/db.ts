import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getDataDir, getDbPath } from './platform/paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(getDataDir(), { recursive: true });
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function tableColumns(database: Database.Database, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  if (!tableColumns(database, table).has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_path TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      parser_backend TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      FOREIGN KEY(session_id) REFERENCES piflow_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_piflow_messages_session ON piflow_messages(session_id, created_at);
  `);

  ensureColumn(database, 'documents', 'source_page_count', 'source_page_count INTEGER');
  ensureColumn(database, 'documents', 'indexed_page_count', 'indexed_page_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'documents', 'ingest_complete', 'ingest_complete INTEGER NOT NULL DEFAULT 0');
  ensureColumn(database, 'piflow_messages', 'citations_json', 'citations_json TEXT');

  // Pre-fingerprint native docs with chunks are treated complete; PDFs rebuild page hashes once.
  database.exec(`
    UPDATE documents
    SET ingest_complete = 1
    WHERE chunk_count > 0
      AND ingest_complete = 0
      AND lower(source_path) NOT LIKE '%.pdf'
  `);
}

export interface StoredDocument {
  id: string;
  title: string;
  source_path: string;
  mime_type: string;
  mtime_ms: number;
  parser_backend: string;
  chunk_count: number;
  source_page_count: number | null;
  indexed_page_count: number;
  ingest_complete: number;
  created_at: string;
  updated_at: string;
}

export interface StoredDocumentPage {
  document_id: string;
  page: number;
  content_hash: string;
  chunk_count: number;
}

export function findDocumentByPath(sourcePath: string): StoredDocument | undefined {
  return getDb()
    .prepare('SELECT * FROM documents WHERE source_path = ?')
    .get(sourcePath) as StoredDocument | undefined;
}

export function listDocuments(): StoredDocument[] {
  return getDb()
    .prepare('SELECT * FROM documents ORDER BY updated_at DESC')
    .all() as StoredDocument[];
}

export function deleteDocumentChunks(documentId: string): void {
  getDb().prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
  getDb().prepare('DELETE FROM document_pages WHERE document_id = ?').run(documentId);
}

export function deleteChunksForPage(documentId: string, page: number): void {
  getDb()
    .prepare(
      `DELETE FROM chunks
       WHERE document_id = ?
         AND json_extract(metadata_json, '$.page') = ?`,
    )
    .run(documentId, page);
}

export function deletePagesBeyond(documentId: string, maxPage: number): void {
  getDb()
    .prepare(
      `DELETE FROM chunks
       WHERE document_id = ?
         AND json_extract(metadata_json, '$.page') > ?`,
    )
    .run(documentId, maxPage);
  getDb()
    .prepare('DELETE FROM document_pages WHERE document_id = ? AND page > ?')
    .run(documentId, maxPage);
}

export function listDocumentPages(documentId: string): StoredDocumentPage[] {
  return getDb()
    .prepare(
      'SELECT document_id, page, content_hash, chunk_count FROM document_pages WHERE document_id = ? ORDER BY page',
    )
    .all(documentId) as StoredDocumentPage[];
}

export function upsertDocumentPage(page: StoredDocumentPage): void {
  getDb()
    .prepare(
      `INSERT INTO document_pages (document_id, page, content_hash, chunk_count)
       VALUES (@document_id, @page, @content_hash, @chunk_count)
       ON CONFLICT(document_id, page) DO UPDATE SET
         content_hash = excluded.content_hash,
         chunk_count = excluded.chunk_count`,
    )
    .run(page);
}

export function countDocumentChunks(documentId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM chunks WHERE document_id = ?')
    .get(documentId) as { c: number };
  return row.c;
}

export function insertDocument(doc: StoredDocument): void {
  getDb()
    .prepare(
      `INSERT INTO documents (
         id, title, source_path, mime_type, mtime_ms, parser_backend, chunk_count,
         source_page_count, indexed_page_count, ingest_complete, created_at, updated_at
       )
       VALUES (
         @id, @title, @source_path, @mime_type, @mtime_ms, @parser_backend, @chunk_count,
         @source_page_count, @indexed_page_count, @ingest_complete, @created_at, @updated_at
       )
       ON CONFLICT(source_path) DO UPDATE SET
         title = excluded.title,
         mime_type = excluded.mime_type,
         mtime_ms = excluded.mtime_ms,
         parser_backend = excluded.parser_backend,
         chunk_count = excluded.chunk_count,
         source_page_count = excluded.source_page_count,
         indexed_page_count = excluded.indexed_page_count,
         ingest_complete = excluded.ingest_complete,
         updated_at = excluded.updated_at`,
    )
    .run(doc);
}

export function insertChunk(
  id: string,
  documentId: string,
  content: string,
  metadataJson: string,
  embedding: Buffer,
): void {
  getDb()
    .prepare(
      `INSERT INTO chunks (id, document_id, content, metadata_json, embedding) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, documentId, content, metadataJson, embedding);
}

export function countChunks(): number {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number };
  return row.c;
}

export interface StoredChunkRow {
  id: string;
  document_id: string;
  content: string;
  metadata_json: string;
  embedding: Buffer;
  document_title: string;
  source_path: string;
}

export function listSearchableChunks(): StoredChunkRow[] {
  return getDb()
    .prepare(
      `SELECT c.id, c.document_id, c.content, c.metadata_json, c.embedding,
              d.title AS document_title, d.source_path
       FROM chunks c
       JOIN documents d ON d.id = c.document_id`,
    )
    .all() as StoredChunkRow[];
}

export function getChunkById(chunkId: string): StoredChunkRow | undefined {
  return getDb()
    .prepare(
      `SELECT c.id, c.document_id, c.content, c.metadata_json, c.embedding,
              d.title AS document_title, d.source_path
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.id = ?`,
    )
    .get(chunkId) as StoredChunkRow | undefined;
}

export function countDocuments(): number {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number };
  return row.c;
}
