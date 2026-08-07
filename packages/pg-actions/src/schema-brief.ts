import type { TableMeta } from './schema-cache.js';

export type BuildBriefInput = {
  databaseLabel: string;
  schemas: string[];
  tablesBySchema: Record<string, TableMeta[]>;
  fetchedAt: number;
  maxChars: number;
  maxColumnsPerTable: number;
  expandSchemas: string[];
};

function formatColumns(table: TableMeta, maxColumns: number): string {
  const cols = table.columns ?? [];
  if (cols.length === 0) return '(columns unknown)';
  const shown = cols.slice(0, maxColumns).map((c) => c.column_name);
  const extra = cols.length > maxColumns ? `, ...(+${cols.length - maxColumns})` : '';
  return `(${shown.join(', ')}${extra})`;
}

/** Compress schema snapshot into a prompt-friendly Markdown brief. */
export function buildSchemaBrief(input: BuildBriefInput): string {
  const refreshed = new Date(input.fetchedAt).toISOString();
  const lines: string[] = [
    `# Database schema (${input.databaseLabel})  refreshed=${refreshed}`,
    '',
    `Schemas: ${input.schemas.join(', ') || '(none)'}`,
    '',
    'Prefer writing read-only SQL directly from this schema.',
    'Use pg_describe_table / pg_list_tables only if a table or column is missing or unclear.',
    '',
  ];

  let truncated = false;

  for (const schema of input.expandSchemas) {
    const tables = input.tablesBySchema[schema] ?? [];
    lines.push(`## ${schema} (${tables.length} tables/views)`);
    if (tables.length === 0) {
      lines.push('- (no tables)');
      lines.push('');
      continue;
    }

    for (const table of tables) {
      const row = `- ${table.table_name}${table.table_type !== 'BASE TABLE' ? ` [${table.table_type}]` : ''}${formatColumns(table, input.maxColumnsPerTable)}`;
      const candidate = [...lines, row, ''].join('\n');
      if (candidate.length > input.maxChars) {
        truncated = true;
        break;
      }
      lines.push(row);
    }
    if (truncated) break;
    lines.push('');
  }

  const other = input.schemas.filter((s) => !input.expandSchemas.includes(s));
  if (!truncated && other.length > 0) {
    lines.push(`## Other schemas (names only)`);
    lines.push(`- ${other.join(', ')}`);
    lines.push('');
  }

  if (truncated) {
    lines.push('_Schema brief truncated to fit context budget._');
    lines.push('');
  }

  let text = lines.join('\n').trimEnd() + '\n';
  if (text.length > input.maxChars) {
    text = `${text.slice(0, Math.max(0, input.maxChars - 80)).trimEnd()}\n\n_Schema brief truncated to fit context budget._\n`;
  }
  return text;
}
