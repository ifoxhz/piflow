import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join('d:/dev/raglamp/apps/rag-server/package.json'));
const Database = require('better-sqlite3');
const dbPath = process.argv[2] || 'd:/dev/raglamp/dist-windows/piFlow/seed/piflow.db';
const db = new Database(dbPath, { readonly: true });
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY 1`).all();
const counts = db
  .prepare(
    `SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM chunks) AS chunks,
      (SELECT COUNT(*) FROM piflow_sessions) AS sessions`,
  )
  .get();
console.log(JSON.stringify({ dbPath, tables, counts }, null, 2));
db.close();
