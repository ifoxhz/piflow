import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent';
import type { Citation } from '@bluelamp/core';
import { createPgTools, PG_TOOL_NAMES } from '@bluelamp/pg-actions';
import { createArtifactTurn, type ArtifactTurn } from './artifacts.js';
import { piflowConfig } from './config.js';
import { getPiLlmSettings } from './llm-bridge.js';
import { createKbTools, KB_TOOL_NAMES } from './kb-tools.js';
import { createUiTools, UI_TOOL_NAMES } from './ui-tools.js';
import { createConfiguredSchemaCache } from './schema-service.js';
import {
  activeSkillDirNames,
  getSkillSettings,
  isKnowledgeSkillEnabled,
  isLocalFsSkillEnabled,
  isPostgresSkillEnabled,
  localFsToolNames,
  resolveAgentCwd,
} from './skill-settings.js';

const SYSTEM_PROMPT_BASE = `You are piFlow, the main workflow agent. Only use tools from currently enabled skills.

Rules:
- Chat is the summary: a short headline plus a few outline bullets. Do not dump large Markdown tables or full result grids in the reply — the host opens Canvas for row-level data.
- After pg_query / kb_list_documents / kb_search, the host already shows a table on Canvas. Optionally call ui_present to set title, headline, and 3–7 outline bullets.
- After tool results arrive, always finish with a clear final answer — never stop at “我来查找…”.
- Always follow the no-delete-data skill: never delete or destroy data.
- Do not invent paths, table names, column names, or document quotes.
- For knowledge-base facts, cite with [n] matching kb tool sourceId values.
- Information policy: for facts about documents or databases, use only kb_* and/or pg_* (and local-fs if enabled). You have no web search — never claim you searched the internet, browsed the web, or used online results.
- If tools return nothing useful, say the local knowledge base / database did not contain it. Do not fill gaps with external or “latest online” knowledge.`;

async function loadSkillBody(dirName: string): Promise<string> {
  const dir = path.join(piflowConfig.skillsDir, dirName);
  const skillPath = path.join(dir, 'SKILL.md');
  const raw = await fs.readFile(skillPath, 'utf8');
  let body = raw.replace(/^---[\s\S]*?---\s*/, '').trim();

  // Append references/*.md (e.g. Omnisight field catalog) after the skill body.
  const refDir = path.join(dir, 'references');
  try {
    const files = (await fs.readdir(refDir))
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort();
    for (const file of files) {
      const ref = await fs.readFile(path.join(refDir, file), 'utf8');
      body += `\n\n## Reference document: ${file}\n\n${ref.trim()}`;
    }
  } catch {
    /* no references dir */
  }

  const max = piflowConfig.skillReferenceMaxChars;
  if (body.length > max) {
    console.warn(
      `[piflow] skill ${dirName} body truncated ${body.length} → ${max} chars`,
    );
    body = `${body.slice(0, Math.max(0, max - 80)).trimEnd()}\n\n_(Skill reference truncated to fit context budget.)_\n`;
  } else {
    console.log(`[piflow] skill ${dirName} loaded (${body.length} chars)`);
  }

  return body;
}

async function ensureAgentDir(): Promise<void> {
  await fs.mkdir(piflowConfig.agentDir, { recursive: true });
  const llm = getPiLlmSettings();

  const modelsPath = path.join(piflowConfig.agentDir, 'models.json');
  const models = {
    providers: {
      [llm.providerId]: {
        baseUrl: llm.baseUrl,
        api: 'openai-completions',
        // Placeholder only — real key is injected via ModelRuntime.setRuntimeApiKey.
        apiKey: llm.provider === 'deepseek' ? 'env:DEEPSEEK_API_KEY' : 'ollama',
        models: [
          {
            id: llm.model,
            reasoning: false,
            input: ['text'],
          },
        ],
      },
    },
  };
  await fs.writeFile(modelsPath, `${JSON.stringify(models, null, 2)}\n`, 'utf8');

  const settingsPath = path.join(piflowConfig.agentDir, 'settings.json');
  const settings = {
    defaultProvider: llm.providerId,
    defaultModel: llm.model,
    compaction: { enabled: true },
  };
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function filterSkillsByActive<T extends { name?: string }>(
  skills: T[],
  activeNames: Set<string>,
): T[] {
  return skills.filter((s) => {
    const name = (s.name ?? '').trim();
    return !name || activeNames.has(name);
  });
}

export type SessionBundle = {
  session: AgentSession;
  dispose: () => void;
  /** Citations accumulated from kb_* tools this turn (renumbered). */
  getCitations: () => Citation[];
  artifacts: ArtifactTurn;
};

export async function createWorkflowSession(): Promise<SessionBundle> {
  const llm = getPiLlmSettings();
  if (!llm.configured) {
    if (llm.provider === 'deepseek') {
      throw new Error(
        'DeepSeek is selected but API Key is missing. Open Settings → 模型配置.',
      );
    }
    throw new Error('Ollama is not configured. Open Settings → 模型配置.');
  }
  console.log(`[piflow] LLM backend: ${llm.label} @ ${llm.baseUrl}`);

  const skillSettings = getSkillSettings();
  const knowledgeOn = isKnowledgeSkillEnabled();
  const postgresOn = isPostgresSkillEnabled();
  const localFsOn = isLocalFsSkillEnabled();
  if (!knowledgeOn && !postgresOn && !localFsOn) {
    throw new Error(
      'No piFlow skills enabled. Open Settings and enable Knowledge / Postgres / Local FS.',
    );
  }

  const artifacts = createArtifactTurn();
  const uiTools = createUiTools({ onPresent: (input) => artifacts.present(input) });
  const turnCitations: Citation[] = [];
  const mergeCitations = (next: Citation[]) => {
    const byId = new Map(turnCitations.map((c) => [c.chunkId, c]));
    for (const c of next) byId.set(c.chunkId, c);
    turnCitations.length = 0;
    let i = 1;
    for (const c of byId.values()) {
      turnCitations.push({ ...c, sourceId: `[${i}]` });
      i += 1;
    }
  };

  await ensureAgentDir();

  const activeDirs = activeSkillDirNames();
  const activeNameSet = new Set(activeDirs);
  const loaded = loadSkillsFromDir({
    dir: piflowConfig.skillsDir,
    source: 'piflow',
  });
  const skills = filterSkillsByActive(loaded.skills, activeNameSet);
  const diagnostics = loaded.diagnostics;
  if (diagnostics.length > 0) {
    for (const d of diagnostics) {
      console.warn('[piflow] skill diagnostic:', d);
    }
  }

  const skillSections: string[] = [];
  for (const dirName of activeDirs) {
    try {
      const body = await loadSkillBody(dirName);
      skillSections.push(`## Active skill: ${dirName}\n\n${body}`);
    } catch (err) {
      console.warn(`[piflow] failed to load skill ${dirName}:`, err);
    }
  }

  let schemaSection = '';
  let pgRuntime: ReturnType<typeof createConfiguredSchemaCache>['runtime'] | null = null;
  let pgTools: ReturnType<typeof createPgTools> = [];
  const kbTools = knowledgeOn ? createKbTools({ onCitations: mergeCitations }) : [];

  if (postgresOn) {
    const configured = createConfiguredSchemaCache();
    pgRuntime = configured.runtime;
    const schemaCache = configured.cache;
    if (schemaCache) {
      try {
        const brief = await schemaCache.getBrief();
        if (brief) {
          schemaSection = `\n\n## Database schema cache\n\n${brief}`;
        }
      } catch (err) {
        console.warn('[piflow] schema brief unavailable:', err);
      }
    } else {
      console.log('[piflow] schema cache disabled — pg tools use live information_schema');
      schemaSection = `

## Database schema cache

Disabled. Use pg_list_schemas / pg_list_tables / pg_describe_table against the live database before writing SQL. Do not invent table or column names.`;
    }
    pgTools = createPgTools(pgRuntime, { schemaCache });
  }

  let localFsSection = '';
  if (localFsOn) {
    const ws = skillSettings.localFs.workspacePath;
    localFsSection = `

## Local FS workspace

- Root: \`${ws}\`
- Write: ${skillSettings.localFs.allowWrite ? 'allowed (edit/write)' : 'disabled (read/bash only)'}
- Stay inside this root. Windows note: \`bash\` needs Git Bash (or shellPath) installed.`;
  }

  const capabilityLines = [
    knowledgeOn
      ? '- Knowledge RAG tools enabled (kb_list_documents, kb_search, kb_get_chunk)'
      : '- Knowledge RAG skill disabled',
    postgresOn ? '- Postgres readonly tools enabled' : '- Postgres skill disabled',
    localFsOn
      ? `- Local FS tools enabled: ${localFsToolNames().join(', ')}`
      : '- Local FS skill disabled',
    '- Canvas: host renders tables from tool results; ui_present may set headline/outline. Do not dump large grids in chat.',
  ];

  const systemPrompt = `${SYSTEM_PROMPT_BASE}

## Enabled capabilities

${capabilityLines.join('\n')}

${skillSections.join('\n\n')}${schemaSection}${localFsSection}`;

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(piflowConfig.agentDir, 'auth.json'),
    modelsPath: path.join(piflowConfig.agentDir, 'models.json'),
  });
  await modelRuntime.setRuntimeApiKey(llm.providerId, llm.apiKey);

  const model = modelRuntime.getModel(llm.providerId, llm.model);
  if (!model) {
    throw new Error(
      `Model ${llm.label} not found. Check PIFLOW_LLM_PROVIDER / model env settings.`,
    );
  }

  const settingsManager = SettingsManager.inMemory({
    defaultProvider: llm.providerId,
    defaultModel: llm.model,
    compaction: { enabled: true },
  });

  const cwd = resolveAgentCwd();
  const toolNames = [
    ...(knowledgeOn ? [...KB_TOOL_NAMES] : []),
    ...(postgresOn ? PG_TOOL_NAMES : []),
    ...localFsToolNames(),
    ...UI_TOOL_NAMES,
  ];

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: piflowConfig.agentDir,
    settingsManager,
    systemPromptOverride: () => systemPrompt,
    skillsOverride: () => ({ skills, diagnostics }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir: piflowConfig.agentDir,
    model,
    thinkingLevel: 'off',
    modelRuntime,
    tools: toolNames,
    customTools: [...kbTools, ...pgTools, ...uiTools],
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  return {
    session,
    getCitations: () => [...turnCitations],
    artifacts,
    dispose: () => {
      session.dispose();
      void pgRuntime?.pool?.end();
    },
  };
}
