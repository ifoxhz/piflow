import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelsDir } from '../../platform/paths.js';

export const QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

/** UI/SSE cadence: 1 ≈ every chunk (~2s on CPU) for continuous progress. */
const PROGRESS_EVERY = Number(process.env.BLUELAMP_EMBED_PROGRESS_EVERY ?? 1);

export type EmbedOptions = {
  label?: string;
  /** Absolute index offset when embedding a slice of a larger job. */
  progressBase?: number;
  progressTotal?: number;
  /** Live embed progress (absolute done/total); fires before vectors are returned. */
  onProgress?: (done: number, total: number) => void;
};

type Pending = {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
  label?: string;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function workerEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return path.join(dir, here.endsWith('.ts') ? 'embed-worker.ts' : 'embed-worker.js');
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const entry = workerEntryPath();
  const isTs = entry.endsWith('.ts');

  worker = new Worker(entry, {
    workerData: {
      modelsDir: getModelsDir(),
      hfHost:
        process.env.HF_ENDPOINT ?? process.env.BLUELAMP_HF_MIRROR ?? 'https://hf-mirror.com',
      progressEvery: PROGRESS_EVERY,
    },
    execArgv: isTs ? [...process.execArgv] : [],
  });

  worker.on(
    'message',
    (msg: {
      type: string;
      id?: number;
      done?: number;
      total?: number;
      elapsedMs?: number;
      etaSec?: number;
      vectors?: ArrayBuffer[];
      error?: string;
    }) => {
      if (msg.type === 'hello') {
        console.log('[embedder] worker online');
        return;
      }
      if (msg.type === 'progress' && msg.id != null) {
        const job = pending.get(msg.id);
        const label = job?.label ? ` ${job.label}` : '';
        const eta =
          msg.etaSec != null && msg.etaSec >= 0 ? `, eta ~${msg.etaSec}s` : '';
        console.log(
          `[embedder]${label} ${msg.done}/${msg.total} (${msg.elapsedMs}ms${eta})`,
        );
        if (
          job?.onProgress &&
          typeof msg.done === 'number' &&
          typeof msg.total === 'number'
        ) {
          try {
            job.onProgress(msg.done, msg.total);
          } catch (err) {
            console.error('[embedder] onProgress error', err);
          }
        }
        return;
      }
      if (msg.type === 'result' && msg.id != null) {
        const job = pending.get(msg.id);
        if (!job) return;
        pending.delete(msg.id);
        job.resolve((msg.vectors ?? []).map((buf) => new Float32Array(buf)));
        return;
      }
      if (msg.type === 'error' && msg.id != null) {
        const job = pending.get(msg.id);
        if (!job) return;
        pending.delete(msg.id);
        job.reject(new Error(msg.error ?? 'embed worker error'));
      }
    },
  );

  worker.on('error', (err) => {
    console.error('[embedder] worker error', err);
    for (const [, job] of pending) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    }
    pending.clear();
    worker = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[embedder] worker exited with code ${code}`);
      const err = new Error(`embed worker exited with code ${code}`);
      for (const [, job] of pending) job.reject(err);
      pending.clear();
    }
    worker = null;
  });

  return worker;
}

function embedViaWorker(texts: string[], options: EmbedOptions = {}): Promise<Float32Array[]> {
  if (texts.length === 0) return Promise.resolve([]);
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      label: options.label,
      onProgress: options.onProgress,
    });
    w.postMessage({
      type: 'embed',
      id,
      texts,
      progressBase: options.progressBase ?? 0,
      progressTotal: options.progressTotal ?? texts.length,
    });
  });
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const [vec] = await embedViaWorker([QUERY_PREFIX + query], { label: 'query' });
  return vec;
}

/** Embed texts off the main thread. Prefer small batches from the caller. */
export async function embedTexts(
  texts: string[],
  labelOrOptions?: string | EmbedOptions,
): Promise<Float32Array[]> {
  const options: EmbedOptions =
    typeof labelOrOptions === 'string' ? { label: labelOrOptions } : labelOrOptions ?? {};
  const label = options.label ? ` (${options.label})` : '';
  console.log(`[embedder] queue ${texts.length} texts${label}`);
  const t0 = Date.now();
  const vectors = await embedViaWorker(texts, options);
  console.log(`[embedder] batch done ${vectors.length} vectors in ${Date.now() - t0}ms`);
  return vectors;
}
