import { Hono } from 'hono';
import { countChunks, listDocuments } from '../db.js';

export const documentRoutes = new Hono();

documentRoutes.get('/', (c) => {
  const docs = listDocuments().map((d) => ({
    id: d.id,
    title: d.title,
    sourcePath: d.source_path,
    mimeType: d.mime_type,
    chunkCount: d.chunk_count,
    importedAt: d.updated_at,
  }));

  const totalChunks = countChunks();

  return c.json({ documents: docs, totalChunks });
});

documentRoutes.get('/stats', (c) => {
  const docs = listDocuments();
  return c.json({
    documentCount: docs.length,
    chunkCount: countChunks(),
    lastImport: docs[0]?.updated_at ?? null,
  });
});
