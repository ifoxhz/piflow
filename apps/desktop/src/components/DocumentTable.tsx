import type { DocumentSummary, IngestJob } from '@bluelamp/core';

interface DocumentTableProps {
  documents: DocumentSummary[];
  loading?: boolean;
}

export function DocumentTable({ documents, loading }: DocumentTableProps) {
  return (
    <div className="document-table-wrap">
      <table className="document-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Chunks</th>
            <th>Imported</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={4} className="document-table-empty">
                Loading…
              </td>
            </tr>
          )}
          {!loading && documents.length === 0 && (
            <tr>
              <td colSpan={4} className="document-table-empty">
                No documents indexed yet.
              </td>
            </tr>
          )}
          {!loading &&
            documents.map((d) => (
              <tr key={d.id}>
                <td className="doc-name" title={d.sourcePath}>
                  {d.title}
                </td>
                <td>{mimeLabel(d.mimeType)}</td>
                <td>{d.chunkCount}</td>
                <td>{formatDate(d.importedAt)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function mimeLabel(mime: string) {
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('markdown')) return 'MD';
  if (mime.includes('html')) return 'HTML';
  return 'TXT';
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface IngestProgressBarProps {
  job: IngestJob | null;
  importing: boolean;
}

export function IngestProgressBar({ job, importing }: IngestProgressBarProps) {
  if (!importing || !job) return null;

  const done = job.stats.done + job.stats.failed + job.stats.skipped;
  const total = job.stats.total || 1;
  const pct = Math.round((done / total) * 100);
  const current = job.files.find((f) => f.id === job.currentFileId);

  return (
    <div className="ingest-progress">
      <div className="ingest-progress-bar">
        <div className="ingest-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="ingest-progress-text">
        {done} / {total} files
        {current && <span className="ingest-current"> — Processing: {current.relativePath}</span>}
      </div>
    </div>
  );
}
