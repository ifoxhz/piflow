import fs from 'node:fs';
import { createPgRuntime, withClient } from '@bluelamp/pg-actions';
import { getDataDir } from '../../platform/paths.js';
import { piflowConfig } from './config.js';

export type PostgresSettings = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
};

type StoredPostgresConfig = Partial<PostgresSettings> & {
  connectionString?: string;
  url?: string;
};

const emptySettings = (): PostgresSettings => ({
  host: '',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: '',
  ssl: false,
});

export function buildDatabaseUrl(s: PostgresSettings): string {
  const host = s.host.trim();
  if (!host) return '';
  const port = Number.isFinite(s.port) && s.port > 0 ? s.port : 5432;
  const database = encodeURIComponent(s.database.trim() || 'postgres');
  const user = encodeURIComponent(s.user.trim() || 'postgres');
  const password = encodeURIComponent(s.password ?? '');
  const auth = password ? `${user}:${password}` : user;
  const ssl = s.ssl ? '?sslmode=require' : '';
  return `postgresql://${auth}@${host}:${port}/${database}${ssl}`;
}

export function parseDatabaseUrl(raw: string): PostgresSettings | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!url.protocol.startsWith('postgres')) return null;
    return {
      host: url.hostname || '127.0.0.1',
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent((url.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
      user: decodeURIComponent(url.username || 'postgres'),
      password: decodeURIComponent(url.password || ''),
      ssl: /sslmode=require/i.test(url.search),
    };
  } catch {
    return null;
  }
}

function defaultsFromEnv(): PostgresSettings {
  const fromUrl = parseDatabaseUrl(process.env.DATABASE_URL ?? piflowConfig.databaseUrl ?? '');
  return fromUrl ?? emptySettings();
}

function readStored(): Partial<PostgresSettings> {
  try {
    const raw = fs.readFileSync(piflowConfig.postgresConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as StoredPostgresConfig;
    if (parsed.connectionString || parsed.url) {
      const fromUrl = parseDatabaseUrl(parsed.connectionString || parsed.url || '');
      if (fromUrl) return fromUrl;
    }
    return {
      host: parsed.host?.trim(),
      port: typeof parsed.port === 'number' ? parsed.port : undefined,
      database: parsed.database?.trim(),
      user: parsed.user?.trim(),
      password: typeof parsed.password === 'string' ? parsed.password : undefined,
      ssl: typeof parsed.ssl === 'boolean' ? parsed.ssl : undefined,
    };
  } catch {
    return {};
  }
}

let cache: PostgresSettings | null = null;

export function getPostgresSettings(): PostgresSettings {
  if (cache) return cache;
  const env = defaultsFromEnv();
  const hasFile = fs.existsSync(piflowConfig.postgresConfigPath);
  if (!hasFile) {
    cache = env;
    return cache;
  }
  const stored = readStored();
  cache = {
    host: stored.host ?? '',
    port: stored.port ?? 5432,
    database: stored.database ?? 'postgres',
    user: stored.user ?? 'postgres',
    password: stored.password ?? '',
    ssl: stored.ssl ?? false,
  };
  return cache;
}

export function getDatabaseUrl(): string {
  return buildDatabaseUrl(getPostgresSettings());
}

export function isPostgresConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

function ensureDataDir(): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
}

export function savePostgresSettings(input: Partial<PostgresSettings>): PostgresSettings {
  const current = getPostgresSettings();
  const next: PostgresSettings = {
    host: (input.host ?? current.host).trim(),
    port: Number(input.port ?? current.port) || 5432,
    database: (input.database ?? current.database).trim() || 'postgres',
    user: (input.user ?? current.user).trim() || 'postgres',
    password: input.password ?? current.password ?? '',
    ssl: Boolean(input.ssl ?? current.ssl),
  };

  if (next.host && (next.port < 1 || next.port > 65535)) {
    throw new Error('Port must be between 1 and 65535');
  }

  ensureDataDir();
  fs.writeFileSync(
    piflowConfig.postgresConfigPath,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  );
  cache = next;
  return next;
}

export function clearPostgresSettings(): PostgresSettings {
  const next = emptySettings();
  ensureDataDir();
  fs.writeFileSync(
    piflowConfig.postgresConfigPath,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  );
  cache = next;
  return next;
}

export async function probePostgres(settings: PostgresSettings): Promise<{
  ok: boolean;
  database?: string;
  user?: string;
  error?: string;
}> {
  const connectionString = buildDatabaseUrl(settings);
  if (!connectionString) {
    return { ok: false, error: 'Host is required' };
  }

  const runtime = createPgRuntime({
    connectionString,
    queryTimeoutMs: piflowConfig.pgQueryTimeoutMs,
    maxRows: 1,
  });

  try {
    const info = await withClient(runtime, async (client) => {
      const result = await client.query<{ current_database: string; current_user: string }>(
        'SELECT current_database() AS current_database, current_user AS current_user',
      );
      return result.rows[0];
    });
    return {
      ok: true,
      database: info?.current_database,
      user: info?.current_user,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await runtime.pool?.end();
  }
}
