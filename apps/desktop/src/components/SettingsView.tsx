import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { HealthResponse, LlmConfigResponse, LlmProvider } from '@bluelamp/core';
import {
  fetchLlmConfig,
  fetchServerLogInfo,
  saveLlmConfig,
  type ServerLogInfo,
} from '../api/rag';
import {
  fetchPiFlowSkills,
  fetchPostgresConfig,
  savePiFlowSkillSettings,
  savePostgresConfig,
  testPostgresConfig,
  type PostgresConfig,
} from '../api/piflow';
import { notifyPiFlowSkillsChanged } from '../lib/piflowEvents';

interface SettingsViewProps {
  health: HealthResponse | null;
  healthError: string | null;
}

export function SettingsView({ health, healthError }: SettingsViewProps) {
  const [provider, setProvider] = useState<LlmProvider>('ollama');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [modelZh, setModelZh] = useState('');
  const [dsModel, setDsModel] = useState('deepseek-v4-flash');
  const [dsBaseUrl, setDsBaseUrl] = useState('https://api.deepseek.com/v1');
  /** User-entered key only — never prefilled from server/.env. */
  const [dsApiKey, setDsApiKey] = useState('');
  const [dsApiKeySet, setDsApiKeySet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmConfigResponse | null>(null);

  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('5432');
  const [pgDatabase, setPgDatabase] = useState('postgres');
  const [pgUser, setPgUser] = useState('postgres');
  const [pgPassword, setPgPassword] = useState('');
  const [pgSsl, setPgSsl] = useState(false);
  const [pgLoading, setPgLoading] = useState(true);
  const [pgSaving, setPgSaving] = useState(false);
  const [pgTesting, setPgTesting] = useState(false);
  const [pgLoadError, setPgLoadError] = useState<string | null>(null);
  const [pgSaveError, setPgSaveError] = useState<string | null>(null);
  const [pgStatus, setPgStatus] = useState<string | null>(null);
  const [pgSkillEnabled, setPgSkillEnabled] = useState(true);

  const [kbSkillEnabled, setKbSkillEnabled] = useState(true);
  const [fsEnabled, setFsEnabled] = useState(false);
  const [fsWorkspace, setFsWorkspace] = useState('');
  const [fsAllowWrite, setFsAllowWrite] = useState(true);
  const [fsLoading, setFsLoading] = useState(true);
  const [fsSaving, setFsSaving] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [fsStatus, setFsStatus] = useState<string | null>(null);
  const [kbStatus, setKbStatus] = useState<string | null>(null);
  const [logInfo, setLogInfo] = useState<ServerLogInfo | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [logOpening, setLogOpening] = useState(false);

  const applyLlm = (cfg: LlmConfigResponse) => {
    setProvider(cfg.provider);
    setUrl(cfg.ollama.url);
    setModel(cfg.ollama.model);
    setModelZh(cfg.ollama.modelZh);
    setDsModel(cfg.deepseek.model || 'deepseek-v4-flash');
    setDsBaseUrl(cfg.deepseek.baseUrl || 'https://api.deepseek.com/v1');
    setDsApiKey(''); // never echo secrets into the form
    setDsApiKeySet(cfg.deepseek.apiKeySet);
    setLlmStatus(cfg);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchLlmConfig()
      .then((cfg) => {
        if (cancelled) return;
        applyLlm(cfg);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPgLoading(true);
    setPgLoadError(null);
    fetchPostgresConfig()
      .then((cfg) => {
        if (cancelled) return;
        applyPostgres(cfg);
        setPgStatus(
          cfg.configured
            ? `已配置：${cfg.host}:${cfg.port}/${cfg.database}`
            : '未配置 Postgres（piFlow 工具将提示缺少连接）',
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setPgLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchServerLogInfo()
      .then((info) => {
        if (!cancelled) {
          setLogInfo(info);
          setLogError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLogError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFsLoading(true);
    setFsError(null);
    fetchPiFlowSkills()
      .then(({ settings, skills }) => {
        if (cancelled) return;
        setKbSkillEnabled(settings.knowledge?.enabled ?? true);
        setPgSkillEnabled(settings.postgres.enabled);
        setFsEnabled(settings.localFs.enabled);
        setFsWorkspace(settings.localFs.workspacePath);
        setFsAllowWrite(settings.localFs.allowWrite);
        const kb = skills.find((s) => s.id === 'knowledge-rag');
        setKbStatus(kb?.detail ?? (settings.knowledge?.enabled === false ? '已关闭' : null));
        setFsStatus(
          settings.localFs.enabled
            ? `已启用 · ${settings.localFs.workspacePath || '(未设工作区)'}`
            : '未启用本地文件 skill',
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setFsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setFsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPostgres = (cfg: PostgresConfig) => {
    setPgHost(cfg.host);
    setPgPort(String(cfg.port || 5432));
    setPgDatabase(cfg.database);
    setPgUser(cfg.user);
    setPgPassword(cfg.password);
    setPgSsl(Boolean(cfg.ssl));
  };

  const handleApply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const cfg = await saveLlmConfig({
        provider,
        ollama: {
          url: url.trim(),
          model: model.trim(),
          modelZh: modelZh.trim(),
        },
        deepseek: {
          // Empty keeps existing disk key; never send .env into the form or force-write it.
          ...(dsApiKey.trim() ? { apiKey: dsApiKey.trim() } : {}),
          model: dsModel.trim() || 'deepseek-v4-flash',
          baseUrl: dsBaseUrl.trim() || 'https://api.deepseek.com/v1',
        },
      });
      applyLlm(cfg);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const pgPayload = () => ({
    host: pgHost.trim(),
    port: Number(pgPort) || 5432,
    database: pgDatabase.trim() || 'postgres',
    user: pgUser.trim() || 'postgres',
    password: pgPassword,
    ssl: pgSsl,
  });

  const handlePgSave = async () => {
    setPgSaving(true);
    setPgSaveError(null);
    try {
      await savePiFlowSkillSettings({ postgres: { enabled: pgSkillEnabled } });
      const result = await savePostgresConfig(pgPayload());
      applyPostgres(result);
      const warm = result.schemaWarm;
      if (warm && !warm.ok) {
        setPgStatus(`已保存，但 schema cache 预热失败：${warm.error ?? 'unknown'}`);
      } else if (warm?.ok) {
        setPgStatus(
          `已保存并预热 schema（${warm.tableCount ?? 0} 张表）：${result.host}:${result.port}/${result.database}`,
        );
      } else {
        setPgStatus(
          result.configured
            ? `已保存：${result.host}:${result.port}/${result.database}`
            : '已清空 Postgres 配置',
        );
      }
    } catch (err) {
      setPgSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPgSaving(false);
    }
  };

  const handlePgTest = async () => {
    setPgTesting(true);
    setPgSaveError(null);
    try {
      const result = await testPostgresConfig(pgPayload());
      if (result.ok) {
        setPgStatus(
          `连接成功：db=${result.connectedDatabase ?? '?'} user=${result.connectedUser ?? '?'}`,
        );
      } else {
        setPgSaveError(result.error ?? '连接失败');
      }
    } catch (err) {
      setPgSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPgTesting(false);
    }
  };

  const handlePgClear = async () => {
    setPgSaving(true);
    setPgSaveError(null);
    try {
      const result = await savePostgresConfig({ clear: true });
      applyPostgres(result);
      setPgStatus('已清空 Postgres 配置');
    } catch (err) {
      setPgSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPgSaving(false);
    }
  };

  const handleSkillPackSave = async () => {
    setFsSaving(true);
    setFsError(null);
    try {
      const result = await savePiFlowSkillSettings({
        knowledge: { enabled: kbSkillEnabled },
        postgres: { enabled: pgSkillEnabled },
        localFs: {
          enabled: fsEnabled,
          workspacePath: fsWorkspace.trim(),
          allowWrite: fsAllowWrite,
        },
      });
      setKbSkillEnabled(result.settings.knowledge?.enabled ?? true);
      setPgSkillEnabled(result.settings.postgres.enabled);
      setFsEnabled(result.settings.localFs.enabled);
      setFsWorkspace(result.settings.localFs.workspacePath);
      setFsAllowWrite(result.settings.localFs.allowWrite);
      const kb = result.skills.find((s) => s.id === 'knowledge-rag');
      setKbStatus(kb?.detail ?? null);
      setFsStatus(
        result.settings.localFs.enabled
          ? `已保存并启用 · ${result.settings.localFs.workspacePath}`
          : '已保存（Local FS 关闭）',
      );
      notifyPiFlowSkillsChanged();
    } catch (err) {
      setFsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFsSaving(false);
    }
  };

  return (
    <div className="placeholder-view settings-view">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>模型配置</h3>
        <p className="settings-hint settings-hint-top">
          Ollama 与 DeepSeek 二选一（互斥）。当前选中的提供方同时用于 RAG 问答与
          piFlow。API Key 不会从环境变量填入输入框；切换提供方后两边配置都会保留。
        </p>
        {loadError && <p className="status-error">{loadError}</p>}

        <div className="settings-provider-toggle" role="radiogroup" aria-label="模型提供方">
          <label className={`settings-provider-option${provider === 'ollama' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="llm-provider"
              checked={provider === 'ollama'}
              onChange={() => setProvider('ollama')}
              disabled={loading || saving}
            />
            <span>Ollama</span>
          </label>
          <label className={`settings-provider-option${provider === 'deepseek' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="llm-provider"
              checked={provider === 'deepseek'}
              onChange={() => setProvider('deepseek')}
              disabled={loading || saving}
            />
            <span>DeepSeek</span>
          </label>
        </div>

        {provider === 'ollama' ? (
          <>
            <label className="settings-field">
              <span>服务地址</span>
              <input
                type="url"
                className="dialog-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://10.0.0.7:11434"
                disabled={loading || saving}
              />
            </label>
            <label className="settings-field">
              <span>模型</span>
              <input
                type="text"
                className="dialog-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen3.5:4b"
                disabled={loading || saving}
              />
            </label>
            <label className="settings-field">
              <span>中文模型（可选）</span>
              <input
                type="text"
                className="dialog-input"
                value={modelZh}
                onChange={(e) => setModelZh(e.target.value)}
                placeholder="不填则与上方模型相同"
                disabled={loading || saving}
              />
            </label>
          </>
        ) : (
          <>
            <label className="settings-field">
              <span>API Key</span>
              <input
                type="password"
                className="dialog-input"
                value={dsApiKey}
                onChange={(e) => setDsApiKey(e.target.value)}
                placeholder={dsApiKeySet ? '已保存密钥，留空则保持不变' : 'sk-…'}
                autoComplete="new-password"
                disabled={loading || saving}
              />
            </label>
            <label className="settings-field">
              <span>模型</span>
              <input
                type="text"
                className="dialog-input"
                value={dsModel}
                onChange={(e) => setDsModel(e.target.value)}
                placeholder="deepseek-v4-flash"
                disabled={loading || saving}
              />
            </label>
            <label className="settings-field">
              <span>Base URL（可选）</span>
              <input
                type="url"
                className="dialog-input"
                value={dsBaseUrl}
                onChange={(e) => setDsBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                disabled={loading || saving}
              />
            </label>
          </>
        )}

        {llmStatus && !saveError && (
          <p className="settings-ollama-status">
            当前提供方：<code>{llmStatus.provider}</code>
            {llmStatus.provider === 'ollama' ? (
              llmStatus.ollama.configured ? (
                <>
                  {' '}
                  · <code>{llmStatus.ollama.url}</code> · <code>{llmStatus.ollama.model}</code>
                  {llmStatus.ollama.reachable ? (
                    <span className="status-ok"> · 已连通</span>
                  ) : (
                    <span className="status-warn"> · 暂不可达</span>
                  )}
                </>
              ) : (
                <span className="status-warn"> · 未配置 Ollama 地址</span>
              )
            ) : llmStatus.deepseek.configured ? (
              <>
                {' '}
                · <code>{llmStatus.deepseek.model}</code>
                <span className="status-ok"> · 密钥已配置</span>
              </>
            ) : (
              <span className="status-warn"> · 未配置 DeepSeek API Key</span>
            )}
          </p>
        )}
        {saveError && <p className="status-error">{saveError}</p>}
        <div className="settings-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleApply}
            disabled={loading || saving}
          >
            {saving ? '保存中…' : '确定'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Knowledge RAG（piFlow skill）</h3>
        <p className="settings-hint settings-hint-top">
          默认启用。导入文档并产生 chunks 后变为 ready；Agent 通过 kb_list / kb_search /
          kb_get_chunk 检索知识库。
        </p>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={kbSkillEnabled}
            onChange={(e) => setKbSkillEnabled(e.target.checked)}
            disabled={fsLoading || fsSaving}
          />
          <span>启用 Knowledge RAG skill</span>
        </label>
        {kbStatus && <p className="settings-ollama-status">{kbStatus}</p>}
      </section>

      <section className="settings-section">
        <h3>Postgres（piFlow skill）</h3>
        <p className="settings-hint settings-hint-top">
          独立 skill：只读查询连接。保存连接时会预热 schema cache；禁止 DELETE/DROP 等写操作。
        </p>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={pgSkillEnabled}
            onChange={(e) => setPgSkillEnabled(e.target.checked)}
            disabled={fsLoading || fsSaving}
          />
          <span>启用 Postgres 只读 skill</span>
        </label>
        {pgLoadError && <p className="status-error">{pgLoadError}</p>}
        <label className="settings-field">
          <span>Host</span>
          <input
            type="text"
            className="dialog-input"
            value={pgHost}
            onChange={(e) => setPgHost(e.target.value)}
            placeholder="127.0.0.1"
            disabled={pgLoading || pgSaving}
          />
        </label>
        <label className="settings-field">
          <span>Port</span>
          <input
            type="number"
            className="dialog-input"
            value={pgPort}
            onChange={(e) => setPgPort(e.target.value)}
            placeholder="5432"
            disabled={pgLoading || pgSaving}
          />
        </label>
        <label className="settings-field">
          <span>Database</span>
          <input
            type="text"
            className="dialog-input"
            value={pgDatabase}
            onChange={(e) => setPgDatabase(e.target.value)}
            placeholder="postgres"
            disabled={pgLoading || pgSaving}
          />
        </label>
        <label className="settings-field">
          <span>User</span>
          <input
            type="text"
            className="dialog-input"
            value={pgUser}
            onChange={(e) => setPgUser(e.target.value)}
            placeholder="postgres"
            disabled={pgLoading || pgSaving}
          />
        </label>
        <label className="settings-field">
          <span>Password</span>
          <input
            type="password"
            className="dialog-input"
            value={pgPassword}
            onChange={(e) => setPgPassword(e.target.value)}
            placeholder="••••••••"
            disabled={pgLoading || pgSaving}
          />
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={pgSsl}
            onChange={(e) => setPgSsl(e.target.checked)}
            disabled={pgLoading || pgSaving}
          />
          <span>SSL（sslmode=require）</span>
        </label>
        {pgStatus && !pgSaveError && <p className="settings-ollama-status">{pgStatus}</p>}
        {pgSaveError && <p className="status-error">{pgSaveError}</p>}
        <div className="settings-actions settings-actions-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handlePgClear()}
            disabled={pgLoading || pgSaving || pgTesting}
          >
            清空
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handlePgTest()}
            disabled={pgLoading || pgSaving || pgTesting}
          >
            {pgTesting ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handlePgSave()}
            disabled={pgLoading || pgSaving || pgTesting}
          >
            {pgSaving ? '保存连接…' : '保存连接'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Local FS（piFlow skill）</h3>
        <p className="settings-hint settings-hint-top">
          独立 skill：在指定工作区内用 read / bash / edit / write 操作本地文件。与 Postgres
          skill 分开开关。Windows 上 bash 需要安装 Git Bash。
        </p>
        {fsError && <p className="status-error">{fsError}</p>}
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={fsEnabled}
            onChange={(e) => setFsEnabled(e.target.checked)}
            disabled={fsLoading || fsSaving}
          />
          <span>启用本地文件 skill</span>
        </label>
        <label className="settings-field">
          <span>工作区路径（绝对路径）</span>
          <input
            type="text"
            className="dialog-input"
            value={fsWorkspace}
            onChange={(e) => setFsWorkspace(e.target.value)}
            placeholder="D:\dev\my-project"
            disabled={fsLoading || fsSaving}
          />
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={fsAllowWrite}
            onChange={(e) => setFsAllowWrite(e.target.checked)}
            disabled={fsLoading || fsSaving || !fsEnabled}
          />
          <span>允许写入（edit / write）；关闭则仅 read / bash</span>
        </label>
        {fsStatus && !fsError && <p className="settings-ollama-status">{fsStatus}</p>}
        <div className="settings-actions settings-actions-row">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSkillPackSave()}
            disabled={fsLoading || fsSaving}
          >
            {fsSaving ? '保存中…' : '保存 Skills 开关'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>RAG Server</h3>
        {healthError && <p className="status-error">{healthError}</p>}
        {health && (
          <ul className="model-status-list">
            <li>
              Status: <strong>{health.status}</strong>
            </li>
            {health.models?.map((m) => (
              <li key={m.id}>
                {m.id}: <strong>{m.status}</strong>
                {m.missingFiles && m.missingFiles.length > 0 && (
                  <span className="missing-files"> — missing {m.missingFiles.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {!health && !healthError && <p>Checking server...</p>}
        <p className="settings-hint">
          Run <code>pnpm dev:server</code> and <code>pnpm models:ensure</code> to download models
          via hf-mirror.com.
        </p>
      </section>

      <section className="settings-section">
        <h3>后端日志</h3>
        <p className="settings-hint settings-hint-top">
          服务端 console（含 ingest / OCR / embed / piFlow）写入滚动日志，便于调试性能。单文件约{' '}
          {logInfo?.rotateMaxMb ?? 20}MB，保留最近 {logInfo?.rotateFiles ?? 3} 个。
        </p>
        {logError && <p className="status-error">{logError}</p>}
        {logStatus && !logError && <p className="settings-ollama-status">{logStatus}</p>}
        {logInfo && (
          <>
            <p className="settings-ollama-status">
              <code title={logInfo.logFile}>{logInfo.logFile}</code>
            </p>
            <div className="settings-actions settings-actions-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={logOpening}
                onClick={() => {
                  void (async () => {
                    setLogOpening(true);
                    setLogError(null);
                    setLogStatus(null);
                    try {
                      if (!isTauri()) {
                        await navigator.clipboard.writeText(logInfo.logDir);
                        setLogStatus(`浏览器模式：已复制目录路径 ${logInfo.logDir}`);
                        return;
                      }
                      // Prefer reveal (in opener:default); fallback to openPath.
                      try {
                        await revealItemInDir(logInfo.logFile);
                      } catch {
                        await openPath(logInfo.logDir);
                      }
                    } catch (err) {
                      setLogError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setLogOpening(false);
                    }
                  })();
                }}
              >
                {logOpening ? '打开中…' : '打开日志文件夹'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={logOpening || !logInfo.logFile}
                onClick={() => {
                  void (async () => {
                    setLogOpening(true);
                    setLogError(null);
                    setLogStatus(null);
                    try {
                      if (!isTauri()) {
                        await navigator.clipboard.writeText(logInfo.logFile);
                        setLogStatus(`浏览器模式：已复制文件路径 ${logInfo.logFile}`);
                        return;
                      }
                      await openPath(logInfo.logFile);
                    } catch (err) {
                      setLogError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setLogOpening(false);
                    }
                  })();
                }}
              >
                打开日志文件
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
