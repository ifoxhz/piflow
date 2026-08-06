import { useEffect, useState } from 'react';
import type { HealthResponse, OllamaConfigResponse } from '@bluelamp/core';
import { fetchOllamaConfig, saveOllamaConfig } from '../api/rag';

interface SettingsViewProps {
  health: HealthResponse | null;
  healthError: string | null;
}

export function SettingsView({ health, healthError }: SettingsViewProps) {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('');
  const [modelZh, setModelZh] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<OllamaConfigResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchOllamaConfig()
      .then((cfg) => {
        if (cancelled) return;
        setUrl(cfg.url);
        setModel(cfg.model);
        setModelZh(cfg.modelZh);
        setStatus(cfg);
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

  const handleApply = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const cfg = await saveOllamaConfig({
        url: url.trim(),
        model: model.trim(),
        modelZh: modelZh.trim(),
      });
      setUrl(cfg.url);
      setModel(cfg.model);
      setModelZh(cfg.modelZh);
      setStatus(cfg);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="placeholder-view settings-view">
      <h2>Settings</h2>

      <section className="settings-section">
        <h3>Ollama</h3>
        <p className="settings-hint settings-hint-top">
          配置远端 Ollama 地址与模型。点击「确定」后立即生效，无需重启服务。
        </p>
        {loadError && <p className="status-error">{loadError}</p>}
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
        {status && !saveError && (
          <p className="settings-ollama-status">
            {status.configured ? (
              <>
                当前：<code>{status.url}</code> · 模型 <code>{status.model}</code>
                {status.reachable ? (
                  <span className="status-ok"> · 已连通</span>
                ) : (
                  <span className="status-warn"> · 暂不可达（配置已保存，稍后可再试）</span>
                )}
              </>
            ) : (
              <span className="status-warn">未配置 Ollama 地址，生成将不走远端。</span>
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
    </div>
  );
}
