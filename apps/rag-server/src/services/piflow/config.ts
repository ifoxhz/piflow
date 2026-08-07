import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataDir, getRepoRoot } from '../../platform/paths.js';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const piflowConfig = {
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  pgQueryTimeoutMs: num('PG_QUERY_TIMEOUT_MS', 15_000),
  pgMaxRows: num('PG_MAX_ROWS', 200),
  schemaCacheTtlMs: num('SCHEMA_CACHE_TTL_MS', 30 * 60 * 1000),
  schemaBriefMaxChars: num('SCHEMA_BRIEF_MAX_CHARS', 6000),
  /**
   * When false: do not warm/inject schema brief; pg_* tools hit live information_schema.
   * Temporary experiment default OFF — set PIFLOW_SCHEMA_CACHE=true to re-enable.
   */
  schemaCacheEnabled: bool('PIFLOW_SCHEMA_CACHE', false),
  /**
   * Max chars when concatenating skill SKILL.md + references/*.md into the system prompt.
   * Domain schema doc is ~22KB; default keeps head (pitfalls + full reference until cap).
   */
  skillReferenceMaxChars: num('PIFLOW_SKILL_REF_MAX_CHARS', 28_000),
  /**
   * Soft display / observation budget for tool calls per turn.
   * UI shows n/budget; over-budget is logged but not hard-stopped yet.
   */
  toolBudgetDisplay: num('PIFLOW_TOOL_BUDGET', 10),
  /** Pi agent dir for models.json / settings.json / auth.json */
  agentDir: path.join(getDataDir(), 'piflow-agent'),
  skillsDir: path.resolve(here, '../../../skills'),
  repoRoot: getRepoRoot(),
  schemaCacheDir: path.join(getDataDir(), 'schema-cache'),
  postgresConfigPath: path.join(getDataDir(), 'postgres-config.json'),
};
