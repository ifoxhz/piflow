/**
 * Dedicated thread for BGE-M3 embedding so the HTTP server stays responsive.
 * Messages: { type:'embed', id, texts, progressBase?, progressTotal? } → progress / result / error
 */
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

type WorkerInit = {
  modelsDir: string;
  hfHost: string;
  progressEvery: number;
};

type EmbedRequest = {
  type: 'embed';
  id: number;
  texts: string[];
  /** Absolute progress offset for multi-batch jobs. */
  progressBase?: number;
  progressTotal?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
let onnxPathPatched = false;

/**
 * transformers.js joins local model paths with `/`. On Windows, onnxruntime then
 * opens `\\?\D:\...\models/Xenova/...` which fails; backslash-only extended paths work.
 * Must patch BEFORE importing @huggingface/transformers (it captures Session.create).
 */
async function patchOnnxRuntimePaths(): Promise<void> {
  if (onnxPathPatched || process.platform !== 'win32') return;
  onnxPathPatched = true;
  try {
    const ort = await import('onnxruntime-node');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Session = ort.InferenceSession as any;
    const orig = Session.create.bind(Session);
    Session.create = (modelPath: unknown, ...rest: unknown[]) => {
      if (typeof modelPath === 'string') {
        let p = modelPath;
        if (p.startsWith('\\\\?\\')) p = p.slice(4);
        modelPath = path.normalize(p.replace(/\//g, path.sep));
      }
      return orig(modelPath, ...rest);
    };
  } catch (err) {
    console.warn(
      '[embed-worker] onnx path patch skipped:',
      err instanceof Error ? err.message : err,
    );
  }
}

async function ensureEmbedder(): Promise<void> {
  if (extractor) return;
  await patchOnnxRuntimePaths();
  const { env, pipeline } = await import('@huggingface/transformers');
  const init = workerData as WorkerInit;
  const host = init.hfHost.endsWith('/') ? init.hfHost : `${init.hfHost}/`;
  env.remoteHost = host;
  env.allowLocalModels = true;
  env.localModelPath = path.resolve(init.modelsDir);
  env.allowRemoteModels = false;
  console.log('[embed-worker] loading BGE-M3 from', env.localModelPath);
  extractor = await pipeline('feature-extraction', 'Xenova/bge-m3', { dtype: 'fp16' });
  console.log('[embed-worker] ready');
}

async function handleEmbed(msg: EmbedRequest): Promise<void> {
  await ensureEmbedder();
  const every = Math.max(1, (workerData as WorkerInit).progressEvery || 10);
  const batchTotal = msg.texts.length;
  const progressBase = msg.progressBase ?? 0;
  const progressTotal = msg.progressTotal ?? batchTotal;
  const vectors: Float32Array[] = [];
  const t0 = Date.now();

  for (let i = 0; i < batchTotal; i++) {
    const text = msg.texts[i];
    // Drop string ref ASAP so batch text can be GC'd while later items run.
    msg.texts[i] = '';
    const out = await extractor(text, { pooling: 'cls', normalize: true });
    vectors.push(new Float32Array(out.data));

    const absoluteDone = progressBase + i + 1;
    if (
      absoluteDone === 1 ||
      absoluteDone === progressTotal ||
      absoluteDone % every === 0 ||
      i + 1 === batchTotal
    ) {
      const elapsedMs = Date.now() - t0;
      // ETA from this batch rate is noisy; report absolute counts.
      const rate = (i + 1) / Math.max(1, elapsedMs / 1000);
      const remaining = progressTotal - absoluteDone;
      const etaSec = rate > 0 ? Math.round(remaining / rate) : -1;
      parentPort?.postMessage({
        type: 'progress',
        id: msg.id,
        done: absoluteDone,
        total: progressTotal,
        elapsedMs,
        etaSec,
      });
    }
  }

  const transfer: ArrayBuffer[] = [];
  const payloads = vectors.map((v) => {
    const copy = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
    transfer.push(copy);
    return copy;
  });
  // Allow GC of worker-side Float32Arrays once transferred.
  vectors.length = 0;

  parentPort?.postMessage({ type: 'result', id: msg.id, vectors: payloads }, transfer);
}

parentPort?.on('message', (msg: EmbedRequest) => {
  if (!msg || msg.type !== 'embed') return;
  handleEmbed(msg).catch((err) => {
    parentPort?.postMessage({
      type: 'error',
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

parentPort?.postMessage({ type: 'hello' });
