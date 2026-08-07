import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PgRuntime } from './pool.js';
import { withClient } from './pool.js';
import { buildSchemaBrief } from './schema-brief.js';

export type ColumnMeta = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

export type TableMeta = {
  table_schema: string;
  table_name: string;
  table_type: string;
  columns: ColumnMeta[];
};

export type SchemaCacheSnapshot = {
  connHash: string;
  fetchedAt: number;
  databaseLabel: string;
  schemas: string[];
  tablesBySchema: Record<string, TableMeta[]>;
  brief: string;
};

export type SchemaCacheOptions = {
  cacheDir: string;
  connectionString: string;
  ttlMs?: number;
  briefMaxChars?: number;
  expandSchemas?: string[];
  maxColumnsPerTable?: number;
};

export type SchemaCache = {
  connHash: string;
  getSnapshot(force?: boolean): Promise<SchemaCacheSnapshot | null>;
  getBrief(force?: boolean): Promise<string | null>;
  getSchemas(force?: boolean): Promise<string[]>;
  getTables(schema: string, force?: boolean): Promise<TableMeta[]>;
  getColumns(schema: string, table: string, force?: boolean): Promise<ColumnMeta[]>;
  invalidate(): void;
  warm(force?: boolean): Promise<SchemaCacheSnapshot | null>;
};

const memory = new Map<string, SchemaCacheSnapshot>();

export function hashConnectionString(connectionString: string): string {
  return crypto.createHash('sha256').update(connectionString.trim()).digest('hex').slice(0, 16);
}

function cacheFile(cacheDir: string, connHash: string): string {
  return path.join(cacheDir, `${connHash}.json`);
}

function readDisk(cacheDir: string, connHash: string): SchemaCacheSnapshot | null {
  try {
    const raw = fs.readFileSync(cacheFile(cacheDir, connHash), 'utf8');
    const parsed = JSON.parse(raw) as SchemaCacheSnapshot;
    if (!parsed?.connHash || !parsed.fetchedAt || !parsed.brief) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDisk(cacheDir: string, snapshot: SchemaCacheSnapshot): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile(cacheDir, snapshot.connHash), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function isFresh(snapshot: SchemaCacheSnapshot | null, ttlMs: number): boolean {
  if (!snapshot) return false;
  return Date.now() - snapshot.fetchedAt < ttlMs;
}

async function fetchSnapshot(
  runtime: PgRuntime,
  connHash: string,
  options: Required<Pick<SchemaCacheOptions, 'expandSchemas' | 'briefMaxChars' | 'maxColumnsPerTable'>>,
): Promise<SchemaCacheSnapshot> {
  return withClient(runtime, async (client) => {
    const dbRes = await client.query<{ current_database: string }>(
      'SELECT current_database() AS current_database',
    );
    const databaseLabel = dbRes.rows[0]?.current_database ?? 'postgres';

    const schemaRes = await client.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND schema_name NOT LIKE 'pg_temp_%'
         AND schema_name NOT LIKE 'pg_toast_temp_%'
       ORDER BY schema_name`,
    );
    const schemas = schemaRes.rows.map((r) => r.schema_name);

    const expand = options.expandSchemas.filter((s) => schemas.includes(s));
    // Always expand at least public if present; otherwise first schema.
    if (expand.length === 0 && schemas.length > 0) {
      expand.push(schemas.includes('public') ? 'public' : schemas[0]!);
    }

    const tablesBySchema: Record<string, TableMeta[]> = {};

    for (const schema of expand) {
      const tableRes = await client.query<{
        table_schema: string;
        table_name: string;
        table_type: string;
      }>(
        `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_type, table_name`,
        [schema],
      );

      const colRes = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        ordinal_position: number;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [schema],
      );

      const columnsByTable = new Map<string, ColumnMeta[]>();
      for (const col of colRes.rows) {
        const list = columnsByTable.get(col.table_name) ?? [];
        list.push({
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable,
          column_default: col.column_default,
        });
        columnsByTable.set(col.table_name, list);
      }

      tablesBySchema[schema] = tableRes.rows.map((t) => ({
        table_schema: t.table_schema,
        table_name: t.table_name,
        table_type: t.table_type,
        columns: columnsByTable.get(t.table_name) ?? [],
      }));
    }

    const fetchedAt = Date.now();
    const brief = buildSchemaBrief({
      databaseLabel,
      schemas,
      tablesBySchema,
      fetchedAt,
      maxChars: options.briefMaxChars,
      maxColumnsPerTable: options.maxColumnsPerTable,
      expandSchemas: expand,
    });

    return {
      connHash,
      fetchedAt,
      databaseLabel,
      schemas,
      tablesBySchema,
      brief,
    };
  });
}

export function createSchemaCache(runtime: PgRuntime, options: SchemaCacheOptions): SchemaCache {
  const connHash = hashConnectionString(options.connectionString);
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const briefMaxChars = options.briefMaxChars ?? 6000;
  const expandSchemas = options.expandSchemas ?? ['public'];
  const maxColumnsPerTable = options.maxColumnsPerTable ?? 12;
  const cacheDir = options.cacheDir;

  const loadLocal = (): SchemaCacheSnapshot | null => {
    const mem = memory.get(connHash);
    if (isFresh(mem ?? null, ttlMs)) return mem!;
    const disk = readDisk(cacheDir, connHash);
    if (isFresh(disk, ttlMs)) {
      memory.set(connHash, disk!);
      return disk;
    }
    return null;
  };

  const persist = (snapshot: SchemaCacheSnapshot) => {
    memory.set(connHash, snapshot);
    writeDisk(cacheDir, snapshot);
  };

  const warm = async (force = false): Promise<SchemaCacheSnapshot | null> => {
    if (!runtime.configured) return null;
    if (!force) {
      const local = loadLocal();
      if (local) return local;
    }
    const snapshot = await fetchSnapshot(runtime, connHash, {
      expandSchemas,
      briefMaxChars,
      maxColumnsPerTable,
    });
    persist(snapshot);
    return snapshot;
  };

  const getSnapshot = async (force = false) => warm(force);

  return {
    connHash,
    getSnapshot,
    async getBrief(force = false) {
      const snap = await getSnapshot(force);
      return snap?.brief ?? null;
    },
    async getSchemas(force = false) {
      const snap = await getSnapshot(force);
      return snap?.schemas ?? [];
    },
    async getTables(schema: string, force = false) {
      const snap = await getSnapshot(force);
      if (!snap) return [];
      const key = schema.trim() || 'public';
      if (snap.tablesBySchema[key]) return snap.tablesBySchema[key];

      // Schema not expanded in cache — fetch live once and merge.
      if (!runtime.configured) return [];
      const tables = await withClient(runtime, async (client) => {
        const tableRes = await client.query<{
          table_schema: string;
          table_name: string;
          table_type: string;
        }>(
          `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
           WHERE table_schema = $1
           ORDER BY table_type, table_name`,
          [key],
        );
        return tableRes.rows.map((t) => ({
          ...t,
          columns: [] as ColumnMeta[],
        }));
      });
      snap.tablesBySchema[key] = tables;
      persist(snap);
      return tables;
    },
    async getColumns(schema: string, table: string, force = false) {
      const key = schema.trim() || 'public';
      const tableName = table.trim();
      const snap = await getSnapshot(force);
      const cached = snap?.tablesBySchema[key]?.find((t) => t.table_name === tableName);
      if (cached?.columns?.length) return cached.columns;

      if (!runtime.configured) return [];
      const columns = await withClient(runtime, async (client) => {
        const result = await client.query<ColumnMeta>(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [key, tableName],
        );
        return result.rows;
      });

      if (snap) {
        const list = snap.tablesBySchema[key] ?? [];
        const idx = list.findIndex((t) => t.table_name === tableName);
        if (idx >= 0) {
          list[idx] = { ...list[idx]!, columns };
        } else {
          list.push({
            table_schema: key,
            table_name: tableName,
            table_type: 'BASE TABLE',
            columns,
          });
        }
        snap.tablesBySchema[key] = list;
        persist(snap);
      }
      return columns;
    },
    invalidate() {
      memory.delete(connHash);
      try {
        fs.unlinkSync(cacheFile(cacheDir, connHash));
      } catch {
        // ignore missing
      }
    },
    warm,
  };
}
