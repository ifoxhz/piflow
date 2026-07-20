import type { Citation } from '@bluelamp/core';
import {
  generateAnswerLocalLlm,
  isLocalLlmConfigured,
  preferLocalLlm,
} from '../generation/local-llm.js';
import { generateViaOllama, isOllamaConfigured } from '../generation/ollama.js';
import { generateAnswerLocal } from '../generation/pleias.js';
import { searchChunks, toCitations, type ScoredChunk } from '../retrieval/retriever.js';

export interface ChatResult {
  reply: string;
  citations: Citation[];
}

const USE_LOCAL_PLEIAS = process.env.BLUELAMP_USE_PLEIAS === 'true';

function buildRetrievalAnswer(query: string, chunks: ScoredChunk[], note?: string): string {
  const lines = chunks.map((c, i) => {
    const excerpt = c.content.replace(/\s+/g, ' ').trim().slice(0, 400);
    return `**[${i + 1}] ${c.documentTitle}**\n${excerpt}`;
  });

  const header = note
    ? `${note}\n\n根据知识库检索，以下内容与「${query}」相关：`
    : `根据知识库检索，以下内容与「${query}」相关：`;

  return [header, '', ...lines, '', '以上摘自已导入文档，可参考对应 PDF 获取完整说明。'].join('\n');
}

function useGenerationBackend(): boolean {
  return isOllamaConfigured() || isLocalLlmConfigured() || USE_LOCAL_PLEIAS;
}

async function generateAnswer(query: string, chunks: ScoredChunk[]): Promise<string> {
  if (isLocalLlmConfigured() && (preferLocalLlm() || !isOllamaConfigured())) {
    return generateAnswerLocalLlm(query, chunks);
  }
  if (isOllamaConfigured()) {
    return generateViaOllama(query, chunks);
  }
  return generateAnswerLocal(query, chunks);
}

export async function ask(query: string): Promise<ChatResult> {
  const chunks = await searchChunks(query, 3);

  if (chunks.length === 0) {
    return {
      reply: '知识库中暂无已索引文档。请先在 Knowledge Base 导入文件夹后再提问。',
      citations: [],
    };
  }

  const citations = toCitations(chunks);

  if (!useGenerationBackend()) {
    return { reply: buildRetrievalAnswer(query, chunks), citations };
  }

  try {
    const answer = await generateAnswer(query, chunks);
    return { reply: answer, citations };
  } catch (err) {
    console.error('[chat] generation failed, using retrieval fallback:', err);
    const note =
      err instanceof Error && err.message.includes('fetch')
        ? '无法连接 Ollama 服务器，已改为展示检索摘要：'
        : undefined;
    return {
      reply: buildRetrievalAnswer(query, chunks, note),
      citations,
    };
  }
}
