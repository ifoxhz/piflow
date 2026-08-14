/** First markdown heading in a chunk, stripped of emphasis markers. */
export function extractMarkdownHeading(text: string): string | undefined {
  const match = text.match(/^#{1,6}\s+(.+)$/m);
  if (!match) return undefined;
  const heading = match[1].replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
  return heading || undefined;
}

/** Human-readable location label for citation headers (e.g. "P.3 · FORUM Archive"). */
export function formatCitationLocation(page?: number, heading?: string): string | undefined {
  const parts: string[] = [];
  if (page != null) parts.push(`P.${page}`);
  if (heading) parts.push(heading);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function isIncompleteTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && !trimmed.endsWith('|');
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|?[\s\-:|]+\|?$/.test(line.trim());
}

/**
 * Truncate chunk text for citation previews without cutting mid-table-row
 * or mid-sentence when a natural boundary exists within the tail window.
 */
export function truncateCitationQuote(content: string, maxChars = 140): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxChars) return trimmed;

  let excerpt = trimmed.slice(0, maxChars);

  const lastNewline = excerpt.lastIndexOf('\n');
  if (lastNewline > maxChars * 0.45) {
    const lastLine = excerpt.slice(lastNewline + 1);
    if (isIncompleteTableLine(lastLine) || isTableSeparatorLine(lastLine)) {
      excerpt = excerpt.slice(0, lastNewline).trimEnd();
    }
  }

  const tailStart = Math.max(0, excerpt.length - 140);
  const tail = excerpt.slice(tailStart);
  const sentencePattern = /[。！？!?][\s"'」』)\]]*|\n\n/g;
  let lastBoundary = -1;
  for (const match of tail.matchAll(sentencePattern)) {
    const absolute = tailStart + (match.index ?? 0) + match[0].length;
    if (absolute >= maxChars * 0.45) {
      lastBoundary = absolute;
    }
  }

  if (lastBoundary > 0) {
    excerpt = excerpt.slice(0, lastBoundary).trimEnd();
  } else {
    const paragraphBreak = excerpt.lastIndexOf('\n\n');
    if (paragraphBreak > maxChars * 0.45) {
      excerpt = excerpt.slice(0, paragraphBreak).trimEnd();
    } else {
      excerpt = excerpt.trimEnd();
    }
  }

  if (excerpt.length >= trimmed.length) return trimmed;
  return excerpt.endsWith('…') ? excerpt : `${excerpt}…`;
}
