import { createWriteStream, statSync } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { HealthResponse, ModelCatalogEntry, ModelDownloadProgress } from '@bluelamp/core';
import { getBundleModelsDir, getModelsDir, getRepoRoot } from './platform/paths.js';

export const REQUIRED_EMBEDDING_MODEL_ID = 'embedding.bge-m3';

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

const progressById = new Map<string, ModelDownloadProgress>();
const inflight = new Map<string, Promise<void>>();

function strippedLocalDir(localDir: string): string {
  return localDir.replace(/^models[\\/]/, '');
}

export function resolveModelBase(localDir: string, modelsRoot = getModelsDir()): string {
  return path.join(modelsRoot, strippedLocalDir(localDir));
}

function candidateRoots(): string[] {
  const roots = [getModelsDir()];
  const bundle = getBundleModelsDir();
  if (bundle && path.resolve(bundle) !== path.resolve(roots[0])) {
    roots.push(bundle);
  }
  return roots;
}

async function fileOk(filePath: string): Promise<boolean> {
  try {
    const meta = await stat(filePath);
    return meta.isFile() && meta.size > 0;
  } catch {
    return false;
  }
}

function fileOkSync(filePath: string): boolean {
  try {
    const meta = statSync(filePath);
    return meta.isFile() && meta.size > 0;
  } catch {
    return false;
  }
}

async function missingFilesAt(base: string, requiredFiles: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const file of requiredFiles) {
    if (!(await fileOk(path.join(base, file)))) missing.push(file);
  }
  return missing;
}

export async function loadManifest(): Promise<ModelManifest> {
  await ensureManifestOnDisk();
  const candidates = [
    path.join(getModelsDir(), 'manifest.json'),
    path.join(process.cwd(), 'models', 'manifest.json'),
    path.join(getRepoRoot(), 'models/manifest.json'),
  ];
  const bundle = getBundleModelsDir();
  if (bundle) candidates.splice(1, 0, path.join(bundle, 'manifest.json'));

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

async function ensureManifestOnDisk(): Promise<void> {
  const destDir = getModelsDir();
  const dest = path.join(destDir, 'manifest.json');
  try {
    await access(dest);
    return;
  } catch {
    /* copy from bundle / repo */
  }
  const sources = [
    path.join(process.cwd(), 'models', 'manifest.json'),
    path.join(getRepoRoot(), 'models/manifest.json'),
  ];
  const bundle = getBundleModelsDir();
  if (bundle) sources.unshift(path.join(bundle, 'manifest.json'));
  for (const src of sources) {
    try {
      await access(src);
      await mkdir(destDir, { recursive: true });
      await copyFile(src, dest);
      return;
    } catch {
      /* try next */
    }
  }
}

export async function validateModel(entry: ModelManifestEntry): Promise<{
  status: 'ready' | 'missing' | 'incomplete';
  missingFiles: string[];
  localPath: string;
}> {
  const primary = resolveModelBase(entry.localDir);
  for (const root of candidateRoots()) {
    const base = resolveModelBase(entry.localDir, root);
    const missing = await missingFilesAt(base, entry.requiredFiles);
    if (missing.length === 0) {
      return { status: 'ready', missingFiles: [], localPath: base };
    }
  }
  const missing = await missingFilesAt(primary, entry.requiredFiles);
  return {
    status: missing.length === entry.requiredFiles.length ? 'missing' : 'incomplete',
    missingFiles: missing,
    localPath: primary,
  };
}

/** Directory Transformers.js should load from (user dir, else leftover bundled weights). */
export function getRuntimeModelsDir(): string {
  const primary = getModelsDir();
  const rel = path.join('Xenova', 'bge-m3', 'onnx', 'model_fp16.onnx');
  if (fileOkSync(path.join(primary, rel))) return primary;
  const bundle = getBundleModelsDir();
  if (bundle && fileOkSync(path.join(bundle, rel))) return bundle;
  return primary;
}

function setProgress(id: string, patch: Partial<ModelDownloadProgress>): ModelDownloadProgress {
  const prev = progressById.get(id) ?? {
    modelId: id,
    status: 'idle',
    downloadedBytes: 0,
  };
  const next: ModelDownloadProgress = { ...prev, modelId: id, ...patch };
  if (next.totalBytes && next.totalBytes > 0) {
    next.percent = Math.min(100, Math.round((next.downloadedBytes / next.totalBytes) * 100));
  }
  progressById.set(id, next);
  return next;
}

export function getDownloadProgress(modelId: string): ModelDownloadProgress | undefined {
  return progressById.get(modelId);
}

function mirrorHost(): string {
  const raw =
    process.env.HF_ENDPOINT ?? process.env.PIFLOW_HF_MIRROR ?? 'https://hf-mirror.com';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

async function downloadFile(
  url: string,
  dest: string,
  onBytes: (downloaded: number, total?: number) => void,
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  console.log(`  ↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${url}`);
  }
  const total = Number(res.headers.get('content-length') || '') || undefined;
  const out = createWriteStream(part);
  const nodeBody = Readable.fromWeb(
    res.body as import('stream/web').ReadableStream<Uint8Array>,
  );
  let downloaded = 0;
  let lastEmit = 0;
  nodeBody.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    const now = Date.now();
    if (now - lastEmit >= 250 || downloaded === total) {
      lastEmit = now;
      onBytes(downloaded, total);
    }
  });
  try {
    nodeBody.pipe(out);
    await finished(out);
    onBytes(downloaded, total);
    await rename(part, dest);
  } catch (err) {
    out.destroy();
    await rm(part, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Build ppocrv6_dict.txt from official inference.yml (keeps trailing space entry). */
async function ensurePpocrDictionary(localBase: string): Promise<void> {
  const ymlPath = path.join(localBase, 'ppocr_v6_small/inference.yml');
  const dictPath = path.join(localBase, 'ppocr_v6_small/ppocrv6_dict.txt');
  try {
    await access(ymlPath);
  } catch {
    return;
  }

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

export async function findModelEntry(modelId: string): Promise<ModelManifestEntry> {
  const manifest = await loadManifest();
  const entry = manifest.models.find((m) => m.id === modelId);
  if (!entry) throw new Error(`Unknown model id: ${modelId}`);
  return entry;
}

export async function ensureModel(
  entry: ModelManifestEntry,
  options: { force?: boolean } = {},
): Promise<void> {
  const force = Boolean(options.force);
  const localBase = resolveModelBase(entry.localDir);
  const current = await validateModel(entry);

  if (!force && current.status === 'ready') {
    setProgress(entry.id, {
      status: 'ready',
      file: undefined,
      downloadedBytes: 0,
      percent: 100,
      error: undefined,
    });
    console.log(`✓ ${entry.id} — ready (${current.localPath})`);
    return;
  }

  if (force) {
    console.log(`↻ ${entry.id} — force re-download`);
    await rm(localBase, { recursive: true, force: true });
  } else {
    console.log(`⬇ ${entry.id} — missing: ${current.missingFiles.join(', ')}`);
  }

  setProgress(entry.id, {
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: undefined,
    percent: 0,
    error: undefined,
    file: undefined,
  });

  await mkdir(localBase, { recursive: true });

  const files =
    entry.download.files?.length ?
      entry.download.files
    : entry.requiredFiles.map((name) => {
        const host = mirrorHost();
        const hubPath = entry.download.mirror.replace(host, '').replace(/^\//, '');
        const repo = hubPath.split('/').slice(0, 2).join('/');
        return { name, url: `${host}/${repo}/resolve/main/${name}` };
      });

  try {
    for (const f of files) {
      const dest = path.join(localBase, f.name);
      if (!force && (await fileOk(dest))) continue;
      setProgress(entry.id, { file: f.name, downloadedBytes: 0, percent: 0 });
      await downloadFile(f.url, dest, (downloaded, total) => {
        setProgress(entry.id, {
          status: 'downloading',
          file: f.name,
          downloadedBytes: downloaded,
          totalBytes: total,
        });
      });
    }
    if (entry.id === 'ocr.ppocr-v6-small') {
      await ensurePpocrDictionary(localBase);
    }
    const after = await validateModel(entry);
    if (after.status !== 'ready') {
      throw new Error(`still incomplete after download: ${after.missingFiles.join(', ')}`);
    }
    setProgress(entry.id, {
      status: 'ready',
      file: undefined,
      downloadedBytes: 0,
      percent: 100,
      error: undefined,
    });
    console.log(`✓ ${entry.id} — downloaded → ${localBase}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setProgress(entry.id, { status: 'error', error: message });
    throw err;
  }
}

export function startEnsureModel(
  modelId: string,
  options: { force?: boolean } = {},
): { started: boolean; promise: Promise<void> } {
  const existing = inflight.get(modelId);
  if (existing) {
    return { started: false, promise: existing };
  }
  const promise = (async () => {
    const entry = await findModelEntry(modelId);
    await ensureModel(entry, options);
  })().finally(() => {
    inflight.delete(modelId);
  });
  inflight.set(modelId, promise);
  return { started: true, promise };
}

export function startBackgroundRequiredModelEnsure(): void {
  if (process.env.PIFLOW_SKIP_MODEL_DOWNLOAD === '1') {
    console.log('[models] skip auto-download (PIFLOW_SKIP_MODEL_DOWNLOAD=1)');
    return;
  }
  const { promise } = startEnsureModel(REQUIRED_EMBEDDING_MODEL_ID);
  void promise.catch((err) => {
    console.error(
      `[models] auto-download ${REQUIRED_EMBEDDING_MODEL_ID} failed:`,
      err instanceof Error ? err.message : err,
    );
  });
}

export async function listModelsCatalog(): Promise<{
  modelsDir: string;
  runtimeModelsDir: string;
  requiredId: string;
  models: ModelCatalogEntry[];
}> {
  const manifest = await loadManifest();
  const models: ModelCatalogEntry[] = await Promise.all(
    manifest.models.map(async (entry) => {
      const validation = await validateModel(entry);
      const progress = progressById.get(entry.id);
      const status =
        progress?.status === 'downloading' || progress?.status === 'error'
          ? progress.status
          : validation.status;
      return {
        id: entry.id,
        name: entry.name,
        hubId: entry.hubId,
        localDir: entry.localDir,
        localPath: validation.localPath,
        required: entry.id === REQUIRED_EMBEDDING_MODEL_ID,
        requiredFiles: entry.requiredFiles,
        download: entry.download,
        validation: {
          status,
          missingFiles: validation.missingFiles,
        },
        progress,
      };
    }),
  );
  return {
    modelsDir: getModelsDir(),
    runtimeModelsDir: getRuntimeModelsDir(),
    requiredId: REQUIRED_EMBEDDING_MODEL_ID,
    models,
  };
}

export async function getHealth(): Promise<HealthResponse> {
  try {
    const catalog = await listModelsCatalog();
    const models = catalog.models.map((m) => ({
      id: m.id,
      status: m.validation.status,
      missingFiles: m.validation.missingFiles,
    }));
    const required = catalog.models.find((m) => m.id === catalog.requiredId);
    const requiredReady = required?.validation.status === 'ready';
    return {
      status: requiredReady ? 'ok' : 'degraded',
      ragServer: true,
      models,
    };
  } catch (err) {
    console.error('[models] health catalog failed', err);
    return { status: 'degraded', ragServer: true, models: [] };
  }
}

export async function isRequiredEmbeddingReady(): Promise<boolean> {
  try {
    const entry = await findModelEntry(REQUIRED_EMBEDDING_MODEL_ID);
    const result = await validateModel(entry);
    return result.status === 'ready';
  } catch {
    return false;
  }
}

export function assertRequiredEmbeddingReadySync(): void {
  const onnx = path.join(getRuntimeModelsDir(), 'Xenova', 'bge-m3', 'onnx', 'model_fp16.onnx');
  if (!fileOkSync(onnx)) {
    throw new Error(
      '嵌入模型尚未就绪。请到 Settings 自动下载 BGE-M3，或按说明手动放到模型目录后再试。',
    );
  }
}
