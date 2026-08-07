const DESTRUCTIVE_SQL =
  /\b(DELETE|DROP|TRUNCATE|ALTER|UPDATE|INSERT|CREATE|GRANT|REVOKE|COPY|CALL|EXECUTE|DO)\b/i;

/** Allow only single-statement read queries. */
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) {
    throw new Error('SQL is empty');
  }
  if (trimmed.includes(';')) {
    throw new Error('Multiple SQL statements are not allowed');
  }

  const normalized = trimmed.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
  const first = normalized.trim().split(/\s+/)[0]?.toUpperCase();
  const allowed = new Set(['SELECT', 'WITH', 'SHOW', 'EXPLAIN']);
  if (!first || !allowed.has(first)) {
    throw new Error(`Only read-only SQL is allowed (got "${first ?? 'unknown'}")`);
  }

  const destructive = normalized.match(DESTRUCTIVE_SQL);
  if (destructive) {
    throw new Error(
      `Destructive or mutating SQL is forbidden by no-delete-data policy (found "${destructive[1]}")`,
    );
  }
}

export function ensureLimit(sql: string, maxRows: number): string {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (/\blimit\b/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\nLIMIT ${maxRows}`;
}
