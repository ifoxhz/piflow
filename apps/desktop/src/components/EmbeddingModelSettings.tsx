import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { ModelCatalogEntry, ModelsCatalogResponse } from '@bluelamp/core';
import { fetchModelsCatalog, startModelDownload } from '../api/rag';

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function joinModelPath(modelsDir: string, localDir: string): string {
  const stripped = localDir.replace(/^models[/\\]/, '');
  const sep = modelsDir.includes('\\') ? '\\' : '/';
  return `${modelsDir.replace(/[/\\]+$/, '')}${sep}${stripped.replace(/[/\\]/g, sep)}`;
}

export function EmbeddingModelSettings() {
  const [catalog, setCatalog] = useState<ModelsCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);

  const refresh = useCallback(async () => {
    const data = await fetchModelsCatalog();
    setCatalog(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const required = catalog?.models.find((m) => m.required) ?? catalog?.models[0];
  const downloading = required?.validation.status === 'downloading';
  const needsPoll = Boolean(required && required.validation.status !== 'ready');

  useEffect(() => {
    if (!needsPoll) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [needsPoll, refresh]);

  const handleDownload = async (force = false) => {
    if (!required) return;
    setBusy(true);
    setError(null);
    setStatus(force ? '正在重新下载…' : '开始下载…');
    try {
      await startModelDownload(required.id, { force });
      await refresh();
      setStatus('正在下载，请稍候（约 1.1 GB）…');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDir = async () => {
    if (!catalog) return;
    setOpening(true);
    setError(null);
    setStatus(null);
    try {
      if (!isTauri()) {
        await navigator.clipboard.writeText(catalog.modelsDir);
        setStatus(`已复制目录路径 ${catalog.modelsDir}`);
        return;
      }
      try {
        await revealItemInDir(catalog.modelsDir);
      } catch {
        await openPath(catalog.modelsDir);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`已复制${label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="settings-section">
      <h3>嵌入模型（BGE-M3）</h3>
      <p className="settings-hint settings-hint-top">
        导入与检索需要本机 BGE-M3（约 1.1 GB）。未随安装包分发：启动后会自动下载；也可自行下载后放到下面的目录。
      </p>
      {error && <p className="status-error">{error}</p>}
      {status && !error && <p className="settings-ollama-status">{status}</p>}
      {!catalog && !error && <p>正在读取模型状态…</p>}
      {required && catalog && (
        <>
          <p className="settings-ollama-status">
            状态：{' '}
            <strong className={statusClass(required)}>
              {statusLabel(required)}
            </strong>
            {progressLine(required)}
          </p>
          <div className="settings-actions settings-actions-row settings-actions-start">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || downloading}
              onClick={() => void handleDownload(false)}
            >
              {downloading ? '下载中…' : '自动下载'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={opening}
              onClick={() => void handleOpenDir()}
            >
              打开模型目录
            </button>
          </div>

          <label className="settings-field">
            <span>放到这个目录</span>
            <code className="settings-path-block">
              {joinModelPath(catalog.modelsDir, required.localDir)}
            </code>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void handleCopy(
                  joinModelPath(catalog.modelsDir, required.localDir),
                  '放置路径',
                )
              }
            >
              复制路径
            </button>
          </label>
          <p className="settings-hint">必需文件（保持相同子目录）：</p>
          <ul className="model-download-list">
            {required.requiredFiles.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>

          <p className="settings-hint">
            镜像下载（推荐）：{' '}
            <a href={required.download.mirror} target="_blank" rel="noreferrer">
              {required.download.mirror}
            </a>
          </p>
          <ul className="model-download-list">
            {(required.download.files ?? []).map((f) => (
              <li key={f.name}>
                <code>{f.name}</code>
                <br />
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.url}
                </a>
              </li>
            ))}
          </ul>
          <p className="settings-hint">
            官方备份：{' '}
            <a href={required.download.official} target="_blank" rel="noreferrer">
              {required.download.official}
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function statusClass(model: ModelCatalogEntry): string {
  if (model.validation.status === 'ready') return 'status-ok';
  if (model.validation.status === 'downloading') return 'status-warn';
  if (model.validation.status === 'error') return 'status-error';
  return 'status-warn';
}

function statusLabel(model: ModelCatalogEntry): string {
  switch (model.validation.status) {
    case 'ready':
      return '已就绪';
    case 'downloading':
      return '下载中';
    case 'incomplete':
      return '不完整';
    case 'missing':
      return '未下载';
    case 'error':
      return '失败';
    default:
      return model.validation.status;
  }
}

function progressLine(model: ModelCatalogEntry): string {
  const p = model.progress;
  if (p?.status !== 'downloading') {
    if (model.validation.status === 'error' && p?.error) return ` — ${p.error}`;
    return '';
  }
  const pct = p.percent != null ? `${p.percent}%` : '';
  const bytes =
    p.totalBytes ?
      `${formatBytes(p.downloadedBytes)} / ${formatBytes(p.totalBytes)}`
    : formatBytes(p.downloadedBytes);
  const file = p.file ? ` ${p.file}` : '';
  return ` — ${pct} ${bytes}${file}`;
}
