import { useCallback, useEffect, useState } from 'react';
import type { DocumentSummary } from '@bluelamp/core';
import { fetchDocumentStats, fetchDocuments } from '../api/ingest';
import { fetchModelsCatalog } from '../api/rag';
import { useIngestJob } from '../hooks/useIngestJob';
import { ActivityLog } from './ActivityLog';
import { DocumentTable, IngestProgressBar } from './DocumentTable';
import { ImportFolderDialog } from './ImportFolderDialog';
import { notifyPiFlowSkillsChanged } from '../lib/piflowEvents';

export function KnowledgeView() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [embedReady, setEmbedReady] = useState(false);
  const [embedHint, setEmbedHint] = useState<string | null>(null);

  const refreshEmbed = useCallback(async () => {
    try {
      const catalog = await fetchModelsCatalog();
      const required = catalog.models.find((m) => m.required);
      const ready = required?.validation.status === 'ready';
      setEmbedReady(Boolean(ready));
      if (!ready && required?.progress?.status === 'downloading') {
        const pct = required.progress.percent != null ? ` ${required.progress.percent}%` : '';
        setEmbedHint(`正在下载嵌入模型${pct}… 完成后即可导入。也可到 Settings 查看进度或手动放置。`);
      } else if (!ready) {
        setEmbedHint('嵌入模型尚未就绪。请到 Settings 自动下载 BGE-M3，或按说明手动放到模型目录。');
      } else {
        setEmbedHint(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, stats] = await Promise.all([fetchDocuments(), fetchDocumentStats()]);
      setDocuments(docsRes.documents);
      setTotalChunks(stats.chunkCount);
      notifyPiFlowSkillsChanged();
    } catch {
      /* server offline */
    } finally {
      setLoading(false);
    }
    await refreshEmbed();
  }, [refreshEmbed]);

  const { job, activityLog, importing, error, startImport } = useIngestJob(refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (embedReady) return;
    const timer = window.setInterval(() => {
      void refreshEmbed().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [embedReady, refreshEmbed]);

  const handleImport = async () => {
    setDialogOpen(false);
    await startImport(folderPath.trim());
  };

  return (
    <div className="knowledge-view">
      <header className="knowledge-header">
        <h2>Knowledge Base</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setDialogOpen(true)}
          disabled={importing || !embedReady}
        >
          Import folder
        </button>
      </header>

      <div className="knowledge-stats">
        Indexed: <strong>{documents.length}</strong> docs ·{' '}
        <strong>{totalChunks}</strong> chunks
      </div>

      {embedHint && <div className="knowledge-error">{embedHint}</div>}

      {error && <div className="knowledge-error">{error}</div>}

      <DocumentTable documents={documents} loading={loading && !importing} />

      <IngestProgressBar job={job} importing={importing} />

      <ActivityLog entries={activityLog} />

      <ImportFolderDialog
        open={dialogOpen}
        path={folderPath}
        onPathChange={setFolderPath}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleImport}
        importing={importing}
      />
    </div>
  );
}
