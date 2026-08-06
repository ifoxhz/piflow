import path from 'node:path';
import { getModelsDir } from '../../platform/paths.js';
import { logLlmQueryInput, summarizeChunksForLog } from '../chat/llm-query-log.js';
import type { ScoredChunk } from '../retrieval/retriever.js';
import { buildPleiasPrompt, parsePleiasOutput } from './pleias-prompt.js';
import type { RagPromptOptions } from './rag-instruct-prompt.js';

const GENERATION_TIMEOUT_MS = Number(process.env.BLUELAMP_CHAT_TIMEOUT_MS ?? 120_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let completion: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loading: Promise<any> | null = null;

async function ensureCompletion() {
  if (completion) return completion;
  if (loading) return loading;

  loading = (async () => {
    const { getLlama, LlamaCompletion } = await import('node-llama-cpp');
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

export async function generateAnswerLocal(
  query: string,
  chunks: ScoredChunk[],
  promptOptions?: RagPromptOptions,
): Promise<string> {
  const comp = await ensureCompletion();
  const prompt = buildPleiasPrompt(query, chunks, promptOptions);
  const modelPath = path.join(getModelsDir(), 'Pleias-RAG-1B', 'Pleias-RAG-1B.gguf');
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
    const answer = parsePleiasOutput(raw);
    logLlmQueryInput({
      ts: new Date().toISOString(),
      stage: 'generation',
      backend: 'pleias',
      model: modelPath,
      userQuery: query,
      prompt,
      response: raw,
      retrieved: summarizeChunksForLog(chunks),
    });
    return answer;
  } finally {
    clearTimeout(timer);
  }
}
