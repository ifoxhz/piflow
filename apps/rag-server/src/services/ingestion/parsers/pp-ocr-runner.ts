/**
 * Runs PP-OCR in a forked child so onnxruntime native crashes cannot take down
 * the rag-server (or the BGE embed worker sharing the same process).
 */
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OcrImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const OCR_TIMEOUT_MS = Number(process.env.PIFLOW_OCR_TIMEOUT_MS ?? 120_000);

let child: ChildProcess | null = null;
let nextId = 1;
let ready = false;
const pending = new Map<number, Pending>();
let spawnPromise: Promise<void> | null = null;

function childEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return path.join(dir, here.endsWith('.ts') ? 'pp-ocr-child.ts' : 'pp-ocr-child.js');
}

function rejectAll(err: Error): void {
  for (const [, job] of pending) {
    clearTimeout(job.timer);
    job.reject(err);
  }
  pending.clear();
}

function bindChild(proc: ChildProcess): void {
  proc.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { type?: string; id?: number; ok?: boolean; text?: string; error?: string };
    if (m.type === 'ready') {
      ready = true;
      return;
    }
    if (typeof m.id !== 'number') return;
    const job = pending.get(m.id);
    if (!job) return;
    pending.delete(m.id);
    clearTimeout(job.timer);
    if (m.ok) job.resolve(m.text ?? '');
    else job.reject(new Error(m.error ?? 'ocr child error'));
  });

  proc.on('exit', (code, signal) => {
    const err = new Error(
      `PP-OCR child exited (code=${code ?? '?'} signal=${signal ?? 'none'})`,
    );
    console.warn(`[ingest] ${err.message}`);
    child = null;
    ready = false;
    spawnPromise = null;
    rejectAll(err);
  });

  proc.on('error', (err) => {
    console.warn('[ingest] PP-OCR child error', err);
    child = null;
    ready = false;
    spawnPromise = null;
    rejectAll(err instanceof Error ? err : new Error(String(err)));
  });
}

async function ensureChild(): Promise<ChildProcess> {
  if (child && child.connected && !child.killed) {
    if (!ready) {
      await waitReady(child);
    }
    return child;
  }
  if (spawnPromise) {
    await spawnPromise;
    if (child) return child;
  }

  spawnPromise = (async () => {
    const entry = childEntryPath();
    const isTs = entry.endsWith('.ts');
    console.log('[ingest] starting PP-OCR child process…');
    const proc = fork(entry, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: isTs ? [...process.execArgv] : [],
    });
    child = proc;
    ready = false;
    bindChild(proc);
    await waitReady(proc);
  })();

  await spawnPromise;
  if (!child) throw new Error('PP-OCR child failed to start');
  return child;
}

function waitReady(proc: ChildProcess, ms = 180_000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('PP-OCR child ready timeout'));
    }, ms);
    const onMsg = (msg: unknown) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ready') {
        clearTimeout(timer);
        proc.off('message', onMsg);
        resolve();
      }
    };
    proc.on('message', onMsg);
    // ready may have raced before listener attached
    if (ready) {
      clearTimeout(timer);
      proc.off('message', onMsg);
      resolve();
    }
  });
}

/**
 * OCR one page image in the child. On crash/timeout returns rejection —
 * caller should treat as empty page and continue.
 */
export async function ocrPageImageIsolated(image: OcrImage): Promise<string> {
  const proc = await ensureChild();
  const id = nextId++;
  const copy = image.data.buffer.slice(
    image.data.byteOffset,
    image.data.byteOffset + image.data.byteLength,
  ) as ArrayBuffer;

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      child = null;
      ready = false;
      spawnPromise = null;
      reject(new Error(`PP-OCR timeout after ${OCR_TIMEOUT_MS}ms`));
    }, OCR_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    // child_process IPC structured-clones; no transferList (unlike worker_threads).
    const ok = proc.send({ id, width: image.width, height: image.height, data: copy });
    if (!ok) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new Error('PP-OCR child IPC channel full/closed'));
    }
  });
}
