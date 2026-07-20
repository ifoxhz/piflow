import path from 'node:path';
import { getLlama, LlamaCompletion } from 'node-llama-cpp';
import { getModelsDir } from '../../platform/paths.js';
import type { ScoredChunk } from '../retrieval/retriever.js';
import { buildPleiasPrompt, parsePleiasOutput } from './pleias-prompt.js';

const GENERATION_TIMEOUT_MS = Number(process.env.BLUELAMP_CHAT_TIMEOUT_MS ?? 120_000);

let completion: LlamaCompletion | null = null;
let loading: Promise<LlamaCompletion> | null = null;

async function ensureCompletion(): Promise<LlamaCompletion> {
  if (completion) return completion;
  if (loading) return loading;

  loading = (async () => {
    const modelPath = path.join(getModelsDir(), 'Pleias-RAG-1B', 'Pleias-RAG-1B.gguf');
    console.log('[pleias] loading model from', modelPath);
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 4096 });
    completion = new LlamaCompletion({
      contextSequence: context.getSequence(),
      autoDisposeSequence: false,
    });
    console.log('[pleias] ready');
    return completion;
  })();

  return loading;
}

export async function generateAnswerLocal(query: string, chunks: ScoredChunk[]): Promise<string> {
  const comp = await ensureCompletion();
  const prompt = buildPleiasPrompt(query, chunks);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('generation timeout'), GENERATION_TIMEOUT_MS);

  try {
    const raw = await comp.generateCompletion(prompt, {
      temperature: 0,
      topP: 0.95,
      maxTokens: 600,
      signal: controller.signal,
      stopOnAbortSignal: true,
      customStopTriggers: ['#END#', '<|answer_end|>'],
    });
    return parsePleiasOutput(raw);
  } finally {
    clearTimeout(timer);
  }
}
