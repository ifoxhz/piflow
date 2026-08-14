import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

export function getDataDir(): string {
  return process.env.PIFLOW_DATA_DIR ?? path.join(getRepoRoot(), '.data');
}

/**
 * If the data dir has no SQLite yet, copy the packaged empty seed DB
 * (schema only). Never overwrites an existing piflow.db / bluelamp.db.
 */
export function ensureSeedDatabase(): void {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const next = path.join(dataDir, 'piflow.db');
  const legacy = path.join(dataDir, 'bluelamp.db');
  if (fs.existsSync(next) || fs.existsSync(legacy)) return;

  const seed = process.env.PIFLOW_SEED_DB?.trim();
  if (!seed || !fs.existsSync(seed)) return;

  fs.copyFileSync(seed, next);
  console.log(`[db] seeded empty database from ${seed}`);
}

export function getDbPath(): string {
  ensureSeedDatabase();
  const dataDir = getDataDir();
  const next = path.join(dataDir, 'piflow.db');
  const legacy = path.join(dataDir, 'bluelamp.db');
  // Prefer new name; keep reading legacy until first rename/migration.
  if (fs.existsSync(next) || !fs.existsSync(legacy)) return next;
  try {
    fs.renameSync(legacy, next);
    for (const suffix of ['-wal', '-shm']) {
      const from = `${legacy}${suffix}`;
      const to = `${next}${suffix}`;
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    }
    return next;
  } catch {
    return legacy;
  }
}

export function getModelsDir(): string {
  return process.env.PIFLOW_MODELS_DIR ?? path.join(getRepoRoot(), 'models');
}

/** Windows path → WSL /mnt/c/... when server runs on Linux */
export function normalizeImportPath(input: string): string {
  const trimmed = input.trim();
  if (process.platform === 'win32') {
    return trimmed;
  }
  const win = trimmed.match(/^([A-Za-z]):[\\/]*(.*)$/);
  if (win) {
    const rest = win[2].replace(/\\/g, '/');
    return `/mnt/${win[1].toLowerCase()}/${rest}`;
  }
  return trimmed;
}
