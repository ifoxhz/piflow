import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { HealthResponse } from '@bluelamp/core';
import { getRepoRoot } from './platform/paths.js';

const REPO_ROOT = getRepoRoot();

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

export async function loadManifest(): Promise<ModelManifest> {
  const manifestPath = path.join(REPO_ROOT, 'models/manifest.json');
  const raw = await readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as ModelManifest;
}

export async function validateModel(entry: ModelManifestEntry): Promise<{
  status: 'ready' | 'missing' | 'incomplete';
  missingFiles: string[];
}> {
  const missingFiles: string[] = [];
  const base = path.join(REPO_ROOT, entry.localDir);

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
