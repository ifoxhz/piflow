import type { ScoredChunk } from '../retrieval/retriever.js';

const MAX_SOURCE_CHARS = 1000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Qwen 等 instruct 模型的 RAG prompt（中英文通用） */
export function buildRagInstructPrompt(query: string, chunks: ScoredChunk[]): string {
  const sources = chunks
    .map((c, i) => `[${i + 1}] 文档：${c.documentTitle}\n${truncate(c.content, MAX_SOURCE_CHARS)}`)
    .join('\n\n');

  return `你是知识库问答助手。仅根据下方资料回答，不要编造。引用处标注 [编号]。
请用与问题相同的语言回答（中文问题用中文，英文问题用英文）。

## 资料
${sources}

## 问题
${query}

## 回答`;

}
