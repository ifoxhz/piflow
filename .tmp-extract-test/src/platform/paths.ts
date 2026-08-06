import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

export function getDataDir(): string {
  return process.env.BLUELAMP_DATA_DIR ?? path.join(getRepoRoot(), '.data');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'bluelamp.db');
}

export function getModelsDir(): string {
  return process.env.BLUELAMP_MODELS_DIR ?? path.join(getRepoRoot(), 'models');
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
