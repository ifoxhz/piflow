import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { PgRuntime } from './pool.js';
import { withClient } from './pool.js';
import type { SchemaCache } from './schema-cache.js';
import { assertReadOnlySql, ensureLimit } from './sql-guard.js';

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}

function notConfigured() {
  return textResult(
    'Postgres is not configured. Open Settings → Postgres to set host/database.',
    { configured: false },
  );
}

export type CreatePgToolsOptions = {
  schemaCache?: SchemaCache | null;
};

export function createPgTools(runtime: PgRuntime, options: CreatePgToolsOptions = {}) {
  const cache = options.schemaCache ?? null;

  const pgListSchemas = defineTool({
    name: 'pg_list_schemas',
    label: 'List Schemas',
    description:
      'List non-system Postgres schemas. Prefer the schema brief in context; use this only if needed.',
    parameters: Type.Object({}),
    execute: async () => {
      if (!runtime.configured) return notConfigured();
      if (cache) {
        const schemas = await cache.getSchemas();
        const rows = schemas.map((schema_name) => ({ schema_name }));
        return textResult(JSON.stringify(rows, null, 2), { schemas: rows, cached: true });
      }
      const rows = await withClient(runtime, async (client) => {
        const result = await client.query<{ schema_name: string }>(
          `SELECT schema_name
           FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
           ORDER BY schema_name`,
        );
        return result.rows;
      });
      return textResult(JSON.stringify(rows, null, 2), { schemas: rows, cached: false });
    },
  });

  const pgListTables = defineTool({
    name: 'pg_list_tables',
    label: 'List Tables',
    description:
      'List tables (and views) in a schema. Defaults to public. Prefer the schema brief when possible.',
    parameters: Type.Object({
      schema: Type.Optional(Type.String({ description: 'Schema name, default public' })),
    }),
    execute: async (_id, params) => {
      if (!runtime.configured) return notConfigured();
      const schema = params.schema?.trim() || 'public';
      if (cache) {
        const tables = await cache.getTables(schema);
        const rows = tables.map(({ table_schema, table_name, table_type }) => ({
          table_schema,
          table_name,
          table_type,
        }));
        return textResult(JSON.stringify(rows, null, 2), { schema, tables: rows, cached: true });
      }
      const rows = await withClient(runtime, async (client) => {
        const result = await client.query<{
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
        return result.rows;
      });
      return textResult(JSON.stringify(rows, null, 2), { schema, tables: rows, cached: false });
    },
  });

  const pgDescribeTable = defineTool({
    name: 'pg_describe_table',
    label: 'Describe Table',
    description:
      'Describe columns for a table or view. Prefer the schema brief; use when a column is missing or unclear.',
    parameters: Type.Object({
      table: Type.String({ description: 'Table name' }),
      schema: Type.Optional(Type.String({ description: 'Schema name, default public' })),
    }),
    execute: async (_id, params) => {
      if (!runtime.configured) return notConfigured();
      const schema = params.schema?.trim() || 'public';
      const table = params.table.trim();
      if (!table) throw new Error('table is required');

      if (cache) {
        const columns = await cache.getColumns(schema, table);
        if (columns.length === 0) {
          return textResult(`No columns found for ${schema}.${table}`, {
            schema,
            table,
            columns: [],
            cached: true,
          });
        }
        return textResult(JSON.stringify(columns, null, 2), {
          schema,
          table,
          columns,
          cached: true,
        });
      }

      const rows = await withClient(runtime, async (client) => {
        const result = await client.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, table],
        );
        return result.rows;
      });

      if (rows.length === 0) {
        return textResult(`No columns found for ${schema}.${table}`, {
          schema,
          table,
          columns: [],
          cached: false,
        });
      }
      return textResult(JSON.stringify(rows, null, 2), {
        schema,
        table,
        columns: rows,
        cached: false,
      });
    },
  });

  const pgQuery = defineTool({
    name: 'pg_query',
    label: 'Run Query',
    description:
      'Run a read-only SQL query (SELECT / WITH / SHOW / EXPLAIN). Results are capped by a row limit.',
    parameters: Type.Object({
      sql: Type.String({ description: 'Read-only SQL statement' }),
    }),
    execute: async (_id, params) => {
      if (!runtime.configured) return notConfigured();
      assertReadOnlySql(params.sql);
      const sql = ensureLimit(params.sql, runtime.maxRows);

      const { rows, fields, rowCount } = await withClient(runtime, async (client) => {
        const result = await client.query(sql);
        return {
          rows: result.rows.slice(0, runtime.maxRows),
          fields: result.fields.map((f) => f.name),
          rowCount: result.rowCount ?? result.rows.length,
        };
      });

      const payload = { fields, rowCount, rows };
      return textResult(JSON.stringify(payload, null, 2), payload);
    },
  });

  return [pgListSchemas, pgListTables, pgDescribeTable, pgQuery];
}

export const PG_TOOL_NAMES = [
  'pg_list_schemas',
  'pg_list_tables',
  'pg_describe_table',
  'pg_query',
] as const;
