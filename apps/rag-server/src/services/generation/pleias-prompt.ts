import type { ScoredChunk } from '../retrieval/retriever.js';

const MAX_SOURCE_CHARS = 800;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function buildPleiasPrompt(query: string, chunks: ScoredChunk[]): string {
  const sources = chunks
    .map((chunk, i) => {
      const id = i + 1;
      const body = truncate(chunk.content, MAX_SOURCE_CHARS);
      return `<|source_start|><|source_id_start|>${id}<|source_id_end|>${body}<|source_end|>`;
    })
    .join('\n');

  return [
    `<|query_start|>${query}<|query_end|>`,
    sources,
    '<|source_analysis_start|>',
  ].join('\n');
}

export function parsePleiasOutput(raw: string): string {
  const answerMatch = raw.match(/<\|answer_start\|>([\s\S]*?)(?:<\|answer_end\|>|$)/);
  if (answerMatch?.[1]?.trim()) return answerMatch[1].trim();

  const afterAnalysis = raw.split('<|source_analysis_end|>').pop();
  if (afterAnalysis?.trim()) return afterAnalysis.trim();

  return raw.trim();
}
