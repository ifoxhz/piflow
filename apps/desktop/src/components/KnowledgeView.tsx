import { useCallback, useEffect, useState } from 'react';
import type { DocumentSummary } from '@bluelamp/core';
import { fetchDocumentStats, fetchDocuments } from '../api/ingest';
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
  }, []);

  const { job, activityLog, importing, error, startImport } = useIngestJob(refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
          disabled={importing}
        >
          Import folder
        </button>
      </header>

      <div className="knowledge-stats">
        Indexed: <strong>{documents.length}</strong> docs ·{' '}
        <strong>{totalChunks}</strong> chunks
      </div>

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
