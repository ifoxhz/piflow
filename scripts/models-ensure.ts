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
import { mkdir, access, rm, readFile, writeFile } from 'node:fs/promises';
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
const filterId = process.argv.find(
  (a) => !a.startsWith('-') && a !== process.argv[1] && a !== process.argv[0],
);

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
  await pipeline(
    Readable.fromWeb(res.body as import('stream/web').ReadableStream),
    createWriteStream(dest),
  );
}

/** Build ppocrv6_dict.txt from official inference.yml (keeps trailing space entry). */
async function ensurePpocrDictionary(localBase: string): Promise<void> {
  const ymlPath = path.join(localBase, 'ppocr_v6_small/inference.yml');
  const dictPath = path.join(localBase, 'ppocr_v6_small/ppocrv6_dict.txt');
  if (!(await fileExists(ymlPath))) return;

  const yml = await readFile(ymlPath, 'utf-8');
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*character_dict:\s*$/.test(l));
  if (start < 0) return;

  const chars: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s+(.*)$/);
    if (!m) {
      if (chars.length > 0) break;
      continue;
    }
    let item = m[1].trim();
    if (
      (item.startsWith("'") && item.endsWith("'")) ||
      (item.startsWith('"') && item.endsWith('"'))
    ) {
      item = item.slice(1, -1);
      item = item.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    chars.push(item);
  }
  if (!chars.includes(' ')) chars.push(' ');
  await writeFile(dictPath, chars.map((c) => `${c}\n`).join(''), 'utf-8');
  console.log(`  ✓ wrote ppocrv6_dict.txt (${chars.length} entries)`);
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
    if (entry.id === 'ocr.ppocr-v6-small') {
      await ensurePpocrDictionary(localBase);
    }
    return;
  }

  const hubPath = entry.download.mirror.replace(mirrorHost, '').replace(/^\//, '');
  const repo = hubPath.split('/').slice(0, 2).join('/');

  for (const file of entry.requiredFiles) {
    const url = `${mirrorHost}/${repo}/resolve/main/${file}`;
    await downloadFile(url, path.join(localBase, file));
  }
}

async function main() {
  const mirror =
    process.env.HF_ENDPOINT ?? process.env.PIFLOW_HF_MIRROR ?? 'https://hf-mirror.com';
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
