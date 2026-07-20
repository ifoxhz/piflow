import { env, pipeline } from '@huggingface/transformers';
import { getModelsDir } from '../../platform/paths.js';
import { EMBED_BATCH_SIZE } from './config.js';

export const QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
let loading: Promise<void> | null = null;

async function ensureEmbedder(): Promise<void> {
  if (extractor) return;
  if (loading) return loading;

  loading = (async () => {
    const host = process.env.HF_ENDPOINT ?? process.env.BLUELAMP_HF_MIRROR ?? 'https://hf-mirror.com';
    env.remoteHost = host.endsWith('/') ? host : `${host}/`;
    env.allowLocalModels = true;
    env.localModelPath = getModelsDir();
    env.allowRemoteModels = false;
    console.log('[embedder] loading BGE-M3 from', env.localModelPath);
    extractor = await pipeline('feature-extraction', 'Xenova/bge-m3', { dtype: 'fp16' });
    console.log('[embedder] ready');
  })();

  return loading;
}

async function embedOne(text: string): Promise<Float32Array> {
  await ensureEmbedder();
  const out = await extractor(text, { pooling: 'cls', normalize: true });
  return new Float32Array(out.data);
}

export async function embedQuery(query: string): Promise<Float32Array> {
  return embedOne(QUERY_PREFIX + query);
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  await ensureEmbedder();
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    for (const text of batch) {
      results.push(await embedOne(text));
    }
  }

  return results;
}
