import type {
  CanvasArtifact,
  CanvasKind,
  CanvasTablePayload,
} from '@bluelamp/core';

const MAX_TABLE_ROWS = 50;
const MAX_OUTLINE = 7;
const MAX_KB_SEARCH_PROMOTE = 3;

export type UiPresentInput = {
  artifactId?: string;
  kind?: CanvasKind;
  title?: string;
  headline?: string;
  outline?: string[];
};

export type ArtifactTurn = {
  promoteTool: (toolName: string, result: unknown) => CanvasArtifact | null;
  present: (input: UiPresentInput) => CanvasArtifact | null;
  list: () => CanvasArtifact[];
  latest: () => CanvasArtifact | null;
};

export function extractToolDetails(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (r.details && typeof r.details === 'object' && !Array.isArray(r.details)) {
    return r.details as Record<string, unknown>;
  }
  if ('result' in r && r.result !== result) {
    const nested = extractToolDetails(r.result);
    if (nested) return nested;
  }
  if (
    Array.isArray(r.rows) ||
    Array.isArray(r.hits) ||
    Array.isArray(r.documents) ||
    Array.isArray(r.tables) ||
    Array.isArray(r.schemas) ||
    Array.isArray(r.columns)
  ) {
    return r;
  }
  if (Array.isArray(r.content)) {
    const first = r.content.find(
      (c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text',
    ) as { text?: string } | undefined;
    if (typeof first?.text === 'string' && first.text.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(first.text) as unknown;
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function cellStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(row: unknown): Record<string, unknown> {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return row as Record<string, unknown>;
  }
  return { value: row };
}

function tableFromRows(rows: unknown[], fields?: string[]): CanvasTablePayload {
  const recs = rows.map(asRecord);
  const keys =
    fields && fields.length > 0
      ? fields
      : recs.length > 0
        ? Object.keys(recs[0]!)
        : [];
  const truncated = recs.length > MAX_TABLE_ROWS;
  const slice = recs.slice(0, MAX_TABLE_ROWS);
  return {
    columns: keys.map((key) => ({ key, label: key })),
    rows: slice.map((row) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) out[key] = row[key] ?? '';
      return out;
    }),
    total: recs.length,
    truncated,
  };
}

function outlineFromTable(payload: CanvasTablePayload): string[] {
  const lines: string[] = [];
  if (typeof payload.total === 'number') {
    const shown = payload.rows.length;
    lines.push(
      payload.truncated
        ? `${payload.total} 行（画布展示前 ${shown} 行）`
        : `${payload.total} 行`,
    );
  }
  if (payload.columns.length > 0) {
    const labels = payload.columns.slice(0, 8).map((c) => c.label);
    lines.push(
      `列：${labels.join('、')}${payload.columns.length > 8 ? '…' : ''}`,
    );
  }
  for (const row of payload.rows.slice(0, 4)) {
    const vals = payload.columns
      .slice(0, 3)
      .map((c) => cellStr(row[c.key]))
      .filter(Boolean);
    if (vals.length) lines.push(vals.join(' · '));
  }
  return lines.slice(0, MAX_OUTLINE);
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return out.length ? out.slice(0, MAX_OUTLINE) : undefined;
}

export function createArtifactTurn(): ArtifactTurn {
  const byId = new Map<string, CanvasArtifact>();
  let seq = 0;
  let lastId: string | null = null;
  let kbSearchCount = 0;

  const put = (artifact: CanvasArtifact): CanvasArtifact => {
    byId.set(artifact.id, artifact);
    lastId = artifact.id;
    return artifact;
  };

  const createTable = (
    sourceTool: string,
    title: string,
    headline: string,
    payload: CanvasTablePayload,
  ): CanvasArtifact => {
    seq += 1;
    return put({
      id: `art_${seq}`,
      revision: 1,
      kind: 'table',
      title,
      headline,
      outline: outlineFromTable(payload),
      status: 'ready',
      sourceTool,
      payload,
    });
  };

  const promoteTool = (toolName: string, result: unknown): CanvasArtifact | null => {
    const details = extractToolDetails(result);
    if (!details || details.configured === false) return null;

    switch (toolName) {
      case 'pg_query': {
        const rows = asUnknownArray(details.rows);
        const fields = Array.isArray(details.fields)
          ? details.fields.filter((f): f is string => typeof f === 'string')
          : undefined;
        const payload = tableFromRows(rows, fields);
        const n = typeof details.rowCount === 'number' ? details.rowCount : payload.total ?? 0;
        return createTable('pg_query', '查询结果', `${n} 行`, payload);
      }
      case 'pg_list_tables': {
        const tables = asUnknownArray(details.tables);
        const schema = typeof details.schema === 'string' ? details.schema : 'public';
        const payload = tableFromRows(tables, ['table_schema', 'table_name', 'table_type']);
        return createTable('pg_list_tables', '数据表', `${schema} · ${tables.length} 张表`, payload);
      }
      case 'pg_list_schemas': {
        const schemas = asUnknownArray(details.schemas);
        const payload = tableFromRows(schemas, ['schema_name']);
        return createTable('pg_list_schemas', 'Schemas', `${schemas.length} 个 schema`, payload);
      }
      case 'pg_describe_table': {
        const columns = asUnknownArray(details.columns);
        const schema = typeof details.schema === 'string' ? details.schema : 'public';
        const table = typeof details.table === 'string' ? details.table : 'table';
        const payload = tableFromRows(columns);
        return createTable(
          'pg_describe_table',
          `${schema}.${table}`,
          `${columns.length} 列`,
          payload,
        );
      }
      case 'kb_list_documents': {
        const documents = asUnknownArray(details.documents);
        if (documents.length === 0) return null;
        const payload = tableFromRows(documents, ['title', 'chunkCount', 'sourcePath', 'id']);
        return createTable(
          'kb_list_documents',
          '知识库文档',
          `${documents.length} 篇文档`,
          payload,
        );
      }
      case 'kb_search': {
        kbSearchCount += 1;
        if (kbSearchCount > MAX_KB_SEARCH_PROMOTE) return null;
        const hits = asUnknownArray(details.hits);
        if (hits.length === 0) return null;
        const payload = tableFromRows(hits, [
          'sourceId',
          'documentTitle',
          'page',
          'score',
          'excerpt',
        ]);
        return createTable('kb_search', '检索命中', `${hits.length} 条命中`, payload);
      }
      default:
        return null;
    }
  };

  const present = (input: UiPresentInput): CanvasArtifact | null => {
    const target = input.artifactId
      ? byId.get(input.artifactId)
      : lastId
        ? byId.get(lastId)
        : undefined;
    if (!target) return null;

    const outline = asStringArray(input.outline) ?? target.outline;
    const next: CanvasArtifact = {
      ...target,
      revision: target.revision + 1,
      title: input.title?.trim() || target.title,
      headline: input.headline?.trim() || target.headline,
      outline,
      status: 'ready',
    };
    return put(next);
  };

  return {
    promoteTool,
    present,
    list: () => [...byId.values()],
    latest: () => (lastId ? byId.get(lastId) ?? null : null),
  };
}
