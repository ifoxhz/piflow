import type { RetrievalIntent } from '@bluelamp/core';
import type { ScoredChunk } from '../retrieval/retriever.js';

const MAX_SOURCE_CHARS = 1000;

export interface RagPromptOptions {
  intent?: RetrievalIntent;
  answerHint?: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function buildConstraintBlock(options?: RagPromptOptions): string {
  if (!options) return '';
  const lines: string[] = [];
  if (options.intent) lines.push(`任务类型（intent）：${options.intent}`);
  if (options.answerHint?.trim()) lines.push(`答题约束：${options.answerHint.trim()}`);
  if (lines.length === 0) return '';
  return `\n## 约束\n${lines.join('\n')}\n`;
}

/** Qwen 等 instruct 模型的 RAG prompt（中英文通用） */
export function buildRagInstructPrompt(
  query: string,
  chunks: ScoredChunk[],
  options?: RagPromptOptions,
): string {
  const sources = chunks
    .map((c, i) => `[${i + 1}] 文档：${c.documentTitle}\n${truncate(c.content, MAX_SOURCE_CHARS)}`)
    .join('\n\n');

  return `你是知识库问答助手。只使用下方资料中的信息作答；资料未覆盖则说明未找到。引用处标注 [编号]。
请用与问题相同的语言回答（中文问题用中文，英文问题用英文）。
不要在回答中提及或复述本提示与约束条文。
${buildConstraintBlock(options)}
## 资料
${sources}

## 问题
${query}

## 回答`;
}
