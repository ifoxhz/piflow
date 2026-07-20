import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getDataDir, getDbPath } from './platform/paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(getDataDir(), { recursive: true });
    db = new Database(getDbPath());
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
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
  created_at: string;
  updated_at: string;
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
}

export function insertDocument(doc: StoredDocument): void {
  getDb()
    .prepare(
      `INSERT INTO documents (id, title, source_path, mime_type, mtime_ms, parser_backend, chunk_count, created_at, updated_at)
       VALUES (@id, @title, @source_path, @mime_type, @mtime_ms, @parser_backend, @chunk_count, @created_at, @updated_at)
       ON CONFLICT(source_path) DO UPDATE SET
         title = excluded.title,
         mime_type = excluded.mime_type,
         mtime_ms = excluded.mtime_ms,
         parser_backend = excluded.parser_backend,
         chunk_count = excluded.chunk_count,
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
