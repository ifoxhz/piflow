import pg from 'pg';

export type PgPoolConfig = {
  connectionString: string;
  queryTimeoutMs: number;
  maxRows: number;
};

export type PgRuntime = {
  pool: pg.Pool | null;
  queryTimeoutMs: number;
  maxRows: number;
  configured: boolean;
};

export function createPgRuntime(config: Partial<PgPoolConfig> & { connectionString?: string }): PgRuntime {
  const queryTimeoutMs = config.queryTimeoutMs ?? 15_000;
  const maxRows = config.maxRows ?? 200;
  const connectionString = config.connectionString?.trim();

  if (!connectionString) {
    return { pool: null, queryTimeoutMs, maxRows, configured: false };
  }

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return { pool, queryTimeoutMs, maxRows, configured: true };
}

export async function withClient<T>(
  runtime: PgRuntime,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!runtime.pool) {
    throw new Error('DATABASE_URL is not configured');
  }
  const client = await runtime.pool.connect();
  try {
    await client.query(`SET statement_timeout = ${Math.max(1, runtime.queryTimeoutMs)}`);
    return await fn(client);
  } finally {
    client.release();
  }
}
