import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { HealthResponse } from '@bluelamp/core';
import { getModelsDir, getRepoRoot } from './platform/paths.js';

export interface ModelManifestEntry {
  id: string;
  name: string;
  hubId: string;
  localDir: string;
  requiredFiles: string[];
  download: { mirror: string; official: string; files?: Array<{ name: string; url: string }> };
}

export interface ModelManifest {
  version: number;
  defaults: { mirrorRemoteHost: string };
  models: ModelManifestEntry[];
}

/** Resolve model files relative to BLUELAMP_MODELS_DIR (or repo models/). */
function resolveModelBase(localDir: string): string {
  const modelsDir = getModelsDir();
  const stripped = localDir.replace(/^models[\\/]/, '');
  return path.join(modelsDir, stripped);
}

export async function loadManifest(): Promise<ModelManifest> {
  const candidates = [
    path.join(getModelsDir(), 'manifest.json'),
    path.join(getRepoRoot(), 'models/manifest.json'),
  ];
  let lastErr: unknown;
  for (const manifestPath of candidates) {
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      return JSON.parse(raw) as ModelManifest;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('models/manifest.json not found');
}

export async function validateModel(entry: ModelManifestEntry): Promise<{
  status: 'ready' | 'missing' | 'incomplete';
  missingFiles: string[];
}> {
  const missingFiles: string[] = [];
  const base = resolveModelBase(entry.localDir);

  for (const file of entry.requiredFiles) {
    const filePath = path.join(base, file);
    try {
      await access(filePath);
    } catch {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length === entry.requiredFiles.length) {
    return { status: 'missing', missingFiles };
  }
  if (missingFiles.length > 0) {
    return { status: 'incomplete', missingFiles };
  }
  return { status: 'ready', missingFiles: [] };
}

export async function getHealth(): Promise<HealthResponse> {
  const manifest = await loadManifest();
  const models = await Promise.all(
    manifest.models.map(async (m) => {
      const result = await validateModel(m);
      return { id: m.id, status: result.status, missingFiles: result.missingFiles };
    }),
  );

  const allReady = models.every((m) => m.status === 'ready');
  return {
    status: allReady ? 'ok' : 'degraded',
    ragServer: true,
    models,
  };
}
