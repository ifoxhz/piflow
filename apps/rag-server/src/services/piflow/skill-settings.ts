import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../../platform/paths.js';
import { piflowConfig } from './config.js';
import { isPostgresConfigured } from './postgres-settings.js';

export type LocalFsSettings = {
  enabled: boolean;
  /** Absolute workspace root the agent may read/write. */
  workspacePath: string;
  /** When false, only read + bash (no edit/write). */
  allowWrite: boolean;
};

export type PostgresSkillSettings = {
  enabled: boolean;
};

export type PiFlowSkillSettings = {
  postgres: PostgresSkillSettings;
  localFs: LocalFsSettings;
};

export type PiFlowSkillInfo = {
  id: 'postgres-readonly' | 'local-fs' | 'no-delete-data';
  name: string;
  description: string;
  enabled: boolean;
  ready: boolean;
  detail?: string;
};

const CONFIG_PATH = () => path.join(getDataDir(), 'piflow-skills.json');

const defaults = (): PiFlowSkillSettings => ({
  postgres: { enabled: true },
  localFs: {
    enabled: false,
    workspacePath: '',
    allowWrite: true,
  },
});

let cache: PiFlowSkillSettings | null = null;

function normalize(input: Partial<PiFlowSkillSettings> | null | undefined): PiFlowSkillSettings {
  const base = defaults();
  const local: Partial<LocalFsSettings> = input?.localFs ?? {};
  const postgres: Partial<PostgresSkillSettings> = input?.postgres ?? {};
  return {
    postgres: {
      enabled: typeof postgres.enabled === 'boolean' ? postgres.enabled : base.postgres.enabled,
    },
    localFs: {
      enabled: typeof local.enabled === 'boolean' ? local.enabled : base.localFs.enabled,
      workspacePath:
        typeof local.workspacePath === 'string'
          ? local.workspacePath.trim()
          : base.localFs.workspacePath,
      allowWrite:
        typeof local.allowWrite === 'boolean' ? local.allowWrite : base.localFs.allowWrite,
    },
  };
}

function readStored(): Partial<PiFlowSkillSettings> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf8');
    return JSON.parse(raw) as Partial<PiFlowSkillSettings>;
  } catch {
    return {};
  }
}

export function getSkillSettings(): PiFlowSkillSettings {
  if (cache) return cache;
  cache = normalize(readStored());
  return cache;
}

export function saveSkillSettings(input: Partial<PiFlowSkillSettings>): PiFlowSkillSettings {
  const current = getSkillSettings();
  const next = normalize({
    postgres: { ...current.postgres, ...input.postgres },
    localFs: { ...current.localFs, ...input.localFs },
  });

  if (next.localFs.enabled) {
    const ws = next.localFs.workspacePath;
    if (!ws) throw new Error('Local FS workspace path is required when enabled');
    if (!path.isAbsolute(ws)) throw new Error('Local FS workspace path must be absolute');
    if (!fs.existsSync(ws)) throw new Error(`Local FS workspace does not exist: ${ws}`);
    const stat = fs.statSync(ws);
    if (!stat.isDirectory()) throw new Error('Local FS workspace must be a directory');
  }

  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(CONFIG_PATH(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  cache = next;
  return next;
}

export function isPostgresSkillEnabled(): boolean {
  return getSkillSettings().postgres.enabled;
}

export function isLocalFsSkillEnabled(): boolean {
  const s = getSkillSettings().localFs;
  return s.enabled && Boolean(s.workspacePath);
}

export function getLocalFsWorkspace(): string | null {
  const s = getSkillSettings().localFs;
  if (!s.enabled || !s.workspacePath) return null;
  return s.workspacePath;
}

export function listSkillInfos(): PiFlowSkillInfo[] {
  const s = getSkillSettings();
  const pgReady = isPostgresConfigured();
  const ws = s.localFs.workspacePath;
  const wsReady = Boolean(ws && fs.existsSync(ws) && fs.statSync(ws).isDirectory());

  return [
    {
      id: 'postgres-readonly',
      name: 'Postgres 只读',
      description: '自然语言查询 Postgres（只读 SQL）',
      enabled: s.postgres.enabled,
      ready: s.postgres.enabled && pgReady,
      detail: !s.postgres.enabled
        ? '已关闭'
        : pgReady
          ? '已连接'
          : '未配置连接 · Settings → Postgres',
    },
    {
      id: 'local-fs',
      name: '本地文件',
      description: '读写配置工作区内的本地文件（read/bash/edit/write）',
      enabled: s.localFs.enabled,
      ready: s.localFs.enabled && wsReady,
      detail: !s.localFs.enabled
        ? '已关闭 · Settings → Local FS'
        : wsReady
          ? `${s.localFs.allowWrite ? '读写' : '只读'} · ${ws}`
          : '工作区无效 · Settings → Local FS',
    },
    {
      id: 'no-delete-data',
      name: 'no-delete-data',
      description: '禁止删除/破坏数据（始终生效）',
      enabled: true,
      ready: true,
      detail: '始终启用',
    },
  ];
}

/** Skill directory names to load into Pi for the current settings. */
export function activeSkillDirNames(): string[] {
  const names = ['no-delete-data'];
  if (isPostgresSkillEnabled()) names.push('postgres-readonly');
  if (isLocalFsSkillEnabled()) names.push('local-fs');
  return names;
}

export function localFsToolNames(): string[] {
  const s = getSkillSettings().localFs;
  if (!isLocalFsSkillEnabled()) return [];
  const tools = ['read', 'bash'];
  if (s.allowWrite) tools.push('edit', 'write');
  return tools;
}

export function resolveAgentCwd(): string {
  return getLocalFsWorkspace() ?? piflowConfig.repoRoot;
}
