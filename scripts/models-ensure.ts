#!/usr/bin/env tsx
/**
 * Validate and download models listed in models/manifest.json
 * Default mirror: https://hf-mirror.com
 *
 * Usage:
 *   pnpm models:ensure
 *   pnpm models:download -- embedding.bge-m3
 */
import { createWriteStream } from 'node:fs';
import { mkdir, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

interface ModelManifestEntry {
  id: string;
  localDir: string;
  requiredFiles: string[];
  download: {
    mirror: string;
    files?: Array<{ name: string; url: string }>;
  };
}

interface ModelManifest {
  defaults: { mirrorRemoteHost: string };
  models: ModelManifestEntry[];
}

const force = process.argv.includes('--force');
const filterId = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[1] && a !== process.argv[0]);

async function loadManifest(): Promise<ModelManifest> {
  const raw = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(REPO_ROOT, 'models/manifest.json'), 'utf-8'),
  );
  return JSON.parse(raw);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  console.log(`  ↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(dest));
}

async function ensureModel(entry: ModelManifestEntry, mirrorHost: string): Promise<void> {
  const localBase = path.join(REPO_ROOT, entry.localDir);
  const missing: string[] = [];

  for (const file of entry.requiredFiles) {
    if (!(await fileExists(path.join(localBase, file)))) {
      missing.push(file);
    }
  }

  if (!force && missing.length === 0) {
    console.log(`✓ ${entry.id} — ready`);
    return;
  }

  if (force) {
    console.log(`↻ ${entry.id} — force re-download`);
    await rm(localBase, { recursive: true, force: true });
  } else {
    console.log(`⬇ ${entry.id} — missing: ${missing.join(', ')}`);
  }

  await mkdir(localBase, { recursive: true });

  if (entry.download.files?.length) {
    for (const f of entry.download.files) {
      await downloadFile(f.url, path.join(localBase, f.name));
    }
    return;
  }

  // HuggingFace resolve URLs via mirror
  const hubPath = entry.download.mirror.replace(mirrorHost, '').replace(/^\//, '');
  const repo = hubPath.split('/').slice(0, 2).join('/');

  for (const file of entry.requiredFiles) {
    const url = `${mirrorHost}/${repo}/resolve/main/${file}`;
    await downloadFile(url, path.join(localBase, file));
  }
}

async function main() {
  const mirror = process.env.HF_ENDPOINT ?? process.env.BLUELAMP_HF_MIRROR ?? 'https://hf-mirror.com';
  const host = mirror.endsWith('/') ? mirror.slice(0, -1) : mirror;
  console.log(`[models-ensure] mirror: ${host}`);

  const manifest = await loadManifest();
  const models = filterId
    ? manifest.models.filter((m) => m.id === filterId)
    : manifest.models;

  if (filterId && models.length === 0) {
    console.error(`Unknown model id: ${filterId}`);
    process.exit(1);
  }

  for (const entry of models) {
    await ensureModel(entry, host);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
