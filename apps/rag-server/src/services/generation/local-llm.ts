import path from 'node:path';
import { getLlama, LlamaChatSession, QwenChatWrapper } from 'node-llama-cpp';
import { getModelsDir } from '../../platform/paths.js';
import type { ScoredChunk } from '../retrieval/retriever.js';
import { buildRagInstructPrompt } from './rag-instruct-prompt.js';

/** Relative to BLUELAMP_MODELS_DIR; see models/manifest.json */
export const DEFAULT_QWEN_GGUF = 'Qwen2.5-3B-Instruct/qwen2.5-3b-instruct-q4_k_m.gguf';

const GENERATION_TIMEOUT_MS = Number(process.env.BLUELAMP_CHAT_TIMEOUT_MS ?? 180_000);
const CONTEXT_SIZE = Number(process.env.BLUELAMP_LOCAL_LLM_CONTEXT ?? 8192);

let session: LlamaChatSession | null = null;
let loading: Promise<LlamaChatSession> | null = null;

export function isLocalLlmConfigured(): boolean {
  return process.env.BLUELAMP_USE_LOCAL_LLM === 'true';
}

export function preferLocalLlm(): boolean {
  return process.env.BLUELAMP_PREFER_LOCAL_LLM === 'true';
}

function resolveModelPath(): string {
  const custom = process.env.BLUELAMP_LOCAL_GGUF?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.join(getModelsDir(), custom);
  }
  return path.join(getModelsDir(), DEFAULT_QWEN_GGUF);
}

async function ensureSession(): Promise<LlamaChatSession> {
  if (session) return session;
  if (loading) return loading;

  loading = (async () => {
    const modelPath = resolveModelPath();
    console.log('[local-llm] loading Qwen GGUF from', modelPath);
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: CONTEXT_SIZE });
    session = new LlamaChatSession({
      contextSequence: context.getSequence(),
      chatWrapper: new QwenChatWrapper({ variation: '3', thoughts: 'discourage' }),
    });
    console.log('[local-llm] ready (context=%d)', CONTEXT_SIZE);
    return session;
  })();

  return loading;
}

export async function generateAnswerLocalLlm(
  query: string,
  chunks: ScoredChunk[],
): Promise<string> {
  const chatSession = await ensureSession();
  const prompt = buildRagInstructPrompt(query, chunks);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('generation timeout'), GENERATION_TIMEOUT_MS);

  try {
    chatSession.resetChatHistory();
    const answer = await chatSession.prompt(prompt, {
      maxTokens: 1200,
      temperature: 0.3,
      topP: 0.9,
      signal: controller.signal,
      stopOnAbortSignal: true,
    });
    const text = answer.trim();
    if (!text) throw new Error('Local LLM returned empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
