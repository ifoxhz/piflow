import {
  createPgRuntime,
  createSchemaCache,
  hashConnectionString,
  type SchemaCache,
  type SchemaCacheSnapshot,
} from '@bluelamp/pg-actions';
import { piflowConfig } from './config.js';
import { getDatabaseUrl, isPostgresConfigured } from './postgres-settings.js';

export function createConfiguredSchemaCache(connectionString?: string): {
  runtime: ReturnType<typeof createPgRuntime>;
  cache: SchemaCache | null;
  connectionString: string;
} {
  const url = (connectionString ?? getDatabaseUrl()).trim();
  const runtime = createPgRuntime({
    connectionString: url,
    queryTimeoutMs: piflowConfig.pgQueryTimeoutMs,
    maxRows: piflowConfig.pgMaxRows,
  });
  if (!url || !runtime.configured || !piflowConfig.schemaCacheEnabled) {
    return { runtime, cache: null, connectionString: url };
  }
  const cache = createSchemaCache(runtime, {
    cacheDir: piflowConfig.schemaCacheDir,
    connectionString: url,
    ttlMs: piflowConfig.schemaCacheTtlMs,
    briefMaxChars: piflowConfig.schemaBriefMaxChars,
    expandSchemas: ['public'],
    maxColumnsPerTable: 12,
  });
  return { runtime, cache, connectionString: url };
}

export async function warmSchemaCache(force = false): Promise<{
  ok: boolean;
  snapshot?: SchemaCacheSnapshot;
  error?: string;
  connHash?: string;
}> {
  if (!piflowConfig.schemaCacheEnabled) {
    return { ok: false, error: 'Schema cache is disabled (PIFLOW_SCHEMA_CACHE=false)' };
  }
  if (!isPostgresConfigured()) {
    return { ok: false, error: 'Postgres is not configured' };
  }
  const { runtime, cache, connectionString } = createConfiguredSchemaCache();
  try {
    if (!cache) return { ok: false, error: 'Schema cache unavailable' };
    const snapshot = await cache.warm(force);
    if (!snapshot) return { ok: false, error: 'Failed to warm schema cache' };
    return {
      ok: true,
      snapshot,
      connHash: cache.connHash || hashConnectionString(connectionString),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await runtime.pool?.end();
  }
}

export function invalidateSchemaCache(connectionString?: string): void {
  const url = (connectionString ?? getDatabaseUrl()).trim();
  if (!url) return;
  const { runtime, cache } = createConfiguredSchemaCache(url);
  cache?.invalidate();
  void runtime.pool?.end();
}
