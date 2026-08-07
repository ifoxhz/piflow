import { Hono } from 'hono';
import {
  getOllamaRuntimeConfig,
  updateOllamaConfig,
  type OllamaRuntimeConfig,
} from '../services/generation/ollama-config.js';
import { checkOllamaHealth } from '../services/generation/ollama.js';
import {
  buildDatabaseUrl,
  clearPostgresSettings,
  getPostgresSettings,
  probePostgres,
  savePostgresSettings,
  type PostgresSettings,
} from '../services/piflow/postgres-settings.js';
import { invalidateSchemaCache, warmSchemaCache } from '../services/piflow/schema-service.js';
import {
  getSkillSettings,
  listSkillInfos,
  saveSkillSettings,
  type PiFlowSkillSettings,
} from '../services/piflow/skill-settings.js';
import {
  getLlmConfigPublic,
  updateLlmConfig,
  type LlmConfigUpdate,
  type LlmProvider,
} from '../services/piflow/llm-settings.js';

export const configRoutes = new Hono();

configRoutes.get('/ollama', async (c) => {
  const config = getOllamaRuntimeConfig();
  const reachable = config.url ? await checkOllamaHealth() : false;
  return c.json({ ...config, reachable, configured: Boolean(config.url) });
});

configRoutes.put('/ollama', async (c) => {
  let body: Partial<OllamaRuntimeConfig>;
  try {
    body = (await c.req.json()) as Partial<OllamaRuntimeConfig>;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (body.url !== undefined && typeof body.url !== 'string') {
    return c.json({ error: 'url must be a string' }, 400);
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    return c.json({ error: 'model must be a string' }, 400);
  }
  if (body.modelZh !== undefined && typeof body.modelZh !== 'string') {
    return c.json({ error: 'modelZh must be a string' }, 400);
  }

  if (typeof body.url === 'string' && body.url.trim()) {
    try {
      const parsed = new URL(body.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return c.json({ error: 'url must be http or https' }, 400);
      }
    } catch {
      return c.json({ error: 'url is not a valid URL' }, 400);
    }
  }

  const config = await updateOllamaConfig({
    url: body.url,
    model: body.model,
    modelZh: body.modelZh,
  });
  const reachable = config.url ? await checkOllamaHealth() : false;
  return c.json({ ...config, reachable, configured: Boolean(config.url) });
});

configRoutes.get('/llm', async (c) => {
  return c.json(await getLlmConfigPublic());
});

configRoutes.put('/llm', async (c) => {
  let body: LlmConfigUpdate;
  try {
    body = (await c.req.json()) as LlmConfigUpdate;
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (body.provider !== undefined && body.provider !== 'ollama' && body.provider !== 'deepseek') {
    return c.json({ error: 'provider must be ollama or deepseek' }, 400);
  }

  if (body.ollama) {
    if (body.ollama.url !== undefined && typeof body.ollama.url !== 'string') {
      return c.json({ error: 'ollama.url must be a string' }, 400);
    }
    if (body.ollama.model !== undefined && typeof body.ollama.model !== 'string') {
      return c.json({ error: 'ollama.model must be a string' }, 400);
    }
    if (body.ollama.modelZh !== undefined && typeof body.ollama.modelZh !== 'string') {
      return c.json({ error: 'ollama.modelZh must be a string' }, 400);
    }
    if (typeof body.ollama.url === 'string' && body.ollama.url.trim()) {
      try {
        const parsed = new URL(body.ollama.url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return c.json({ error: 'ollama.url must be http or https' }, 400);
        }
      } catch {
        return c.json({ error: 'ollama.url is not a valid URL' }, 400);
      }
    }
  }

  if (body.deepseek) {
    if (body.deepseek.apiKey !== undefined && typeof body.deepseek.apiKey !== 'string') {
      return c.json({ error: 'deepseek.apiKey must be a string' }, 400);
    }
    if (body.deepseek.model !== undefined && typeof body.deepseek.model !== 'string') {
      return c.json({ error: 'deepseek.model must be a string' }, 400);
    }
    if (body.deepseek.baseUrl !== undefined && typeof body.deepseek.baseUrl !== 'string') {
      return c.json({ error: 'deepseek.baseUrl must be a string' }, 400);
    }
  }

  const provider = (body.provider ?? undefined) as LlmProvider | undefined;
  if (provider === 'deepseek') {
    const preview = await getLlmConfigPublic();
    const incomingKey = body.deepseek?.apiKey?.trim() ?? '';
    if (!incomingKey && !preview.deepseek.apiKeySet) {
      return c.json({ error: '选择 DeepSeek 时请填写 API Key' }, 400);
    }
  }

  const config = await updateLlmConfig(body);
  return c.json(config);
});

function postgresPayload(s: PostgresSettings) {
  const connectionString = buildDatabaseUrl(s);
  return {
    host: s.host,
    port: s.port,
    database: s.database,
    user: s.user,
    password: s.password,
    ssl: s.ssl,
    configured: Boolean(s.host.trim()),
    connectionString: connectionString ? maskPassword(connectionString) : '',
  };
}

function maskPassword(url: string): string {
  return url.replace(/\/\/([^:/]+):([^@]+)@/, '//$1:***@');
}

configRoutes.get('/postgres', (c) => {
  return c.json(postgresPayload(getPostgresSettings()));
});

configRoutes.put('/postgres', async (c) => {
  let body: Partial<PostgresSettings> & { clear?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const previousUrl = buildDatabaseUrl(getPostgresSettings());
    if (previousUrl) invalidateSchemaCache(previousUrl);

    const saved = body.clear
      ? clearPostgresSettings()
      : savePostgresSettings({
          host: body.host,
          port: body.port,
          database: body.database,
          user: body.user,
          password: body.password,
          ssl: body.ssl,
        });

    let schemaWarm: { ok: boolean; error?: string; tableCount?: number } | undefined;
    if (!body.clear && saved.host.trim()) {
      const warm = await warmSchemaCache(true);
      schemaWarm = {
        ok: warm.ok,
        error: warm.error,
        tableCount: warm.snapshot
          ? Object.values(warm.snapshot.tablesBySchema).reduce((n, t) => n + t.length, 0)
          : 0,
      };
    }

    return c.json({ ok: true, ...postgresPayload(saved), schemaWarm });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

configRoutes.post('/postgres/refresh-schema', async (c) => {
  const result = await warmSchemaCache(true);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error ?? 'refresh failed' }, 400);
  }
  const tableCount = Object.values(result.snapshot?.tablesBySchema ?? {}).reduce(
    (n, t) => n + t.length,
    0,
  );
  return c.json({
    ok: true,
    databaseLabel: result.snapshot?.databaseLabel,
    schemaCount: result.snapshot?.schemas.length ?? 0,
    tableCount,
    fetchedAt: result.snapshot?.fetchedAt,
    briefChars: result.snapshot?.brief.length ?? 0,
  });
});

configRoutes.post('/postgres/test', async (c) => {
  let body: Partial<PostgresSettings> = {};
  try {
    body = await c.req.json();
  } catch {
    // optional
  }

  const current = getPostgresSettings();
  const candidate: PostgresSettings = {
    host: body.host?.trim() || current.host,
    port: Number(body.port ?? current.port) || 5432,
    database: body.database?.trim() || current.database,
    user: body.user?.trim() || current.user,
    password: body.password ?? current.password,
    ssl: typeof body.ssl === 'boolean' ? body.ssl : current.ssl,
  };

  const result = await probePostgres(candidate);
  return c.json({
    ok: result.ok,
    error: result.error,
    connectedDatabase: result.database,
    connectedUser: result.user,
    ...postgresPayload(candidate),
  });
});

configRoutes.get('/piflow-skills', (c) => {
  return c.json({
    settings: getSkillSettings(),
    skills: listSkillInfos(),
  });
});

configRoutes.put('/piflow-skills', async (c) => {
  let body: Partial<PiFlowSkillSettings>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const saved = saveSkillSettings(body);
    return c.json({
      ok: true,
      settings: saved,
      skills: listSkillInfos(),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
