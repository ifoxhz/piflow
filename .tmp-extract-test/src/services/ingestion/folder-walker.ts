import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IngestFileTask } from '@bluelamp/core';
import {
  MAX_FILES_PER_JOB,
  MAX_FILE_BYTES,
  SKIP_DIR_NAMES,
  SUPPORTED_EXT,
} from './config.js';

export interface WalkResult {
  files: IngestFileTask[];
  limitNotice?: string;
}

export async function walkFolder(rootPath: string): Promise<WalkResult> {
  const candidates: Array<{ absolutePath: string; relativePath: string; ext: string }> = [];
  const skipped: IngestFileTask[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(rootPath, full).split(path.sep).join('/');

      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || SKIP_DIR_NAMES.has(ent.name)) continue;
        queue.push(full);
        continue;
      }

      if (!ent.isFile()) continue;

      const base = {
        id: randomUUID(),
        absolutePath: full,
        relativePath: rel,
      };

      if (ent.name.startsWith('.')) {
        skipped.push({
          ...base,
          mimeType: 'application/octet-stream',
          status: 'skipped',
          skipReason: 'hidden file',
        });
        continue;
      }

      const ext = path.extname(ent.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) {
        skipped.push({
          ...base,
          mimeType: 'application/octet-stream',
          status: 'skipped',
          skipReason: 'unsupported extension',
        });
        continue;
      }

      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }

      if (size > MAX_FILE_BYTES) {
        skipped.push({
          ...base,
          mimeType: mimeFromExt(ext),
          status: 'skipped',
          skipReason: `file too large, max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`,
        });
        continue;
      }

      candidates.push({ absolutePath: full, relativePath: rel, ext });
    }
  }

  let limitNotice: string | undefined;
  const toProcess = candidates.slice(0, MAX_FILES_PER_JOB);
  if (candidates.length > MAX_FILES_PER_JOB) {
    const excess = candidates.length - MAX_FILES_PER_JOB;
    limitNotice = `import limit reached (${MAX_FILES_PER_JOB} files max), ${excess} files not queued`;
    for (const c of candidates.slice(MAX_FILES_PER_JOB)) {
      skipped.push({
        id: randomUUID(),
        absolutePath: c.absolutePath,
        relativePath: c.relativePath,
        mimeType: mimeFromExt(c.ext),
        status: 'skipped',
        skipReason: 'exceeds per-job file limit',
      });
    }
  }

  const pending: IngestFileTask[] = toProcess.map((c) => ({
    id: randomUUID(),
    absolutePath: c.absolutePath,
    relativePath: c.relativePath,
    mimeType: mimeFromExt(c.ext),
    status: 'pending' as const,
  }));

  return { files: [...pending, ...skipped], limitNotice };
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.html':
    case '.htm':
      return 'text/html';
    default:
      return 'text/plain';
  }
}
