export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type FileTaskStatus =
  | 'pending'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface IngestJobStats {
  total: number;
  pending: number;
  done: number;
  failed: number;
  skipped: number;
  chunksIndexed: number;
}

export interface IngestFileTask {
  id: string;
  absolutePath: string;
  relativePath: string;
  mimeType: string;
  status: FileTaskStatus;
  error?: string;
  skipReason?: string;
  /** Final indexed chunk count when status is done. */
  chunkCount?: number;
  /** Live embed progress for the current file. */
  chunksDone?: number;
  chunksTotal?: number;
  /** Live PDF page-window progress. */
  pagesDone?: number;
  pagesTotal?: number;
  /** Pages reused via content fingerprint (no re-embed). */
  reusedPages?: number;
  /** Pre-parse estimate (pages / chunks / ETA label). */
  estimatedPages?: number;
  estimatedChunks?: number;
  etaLabel?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface IngestJob {
  id: string;
  rootPath: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequested: boolean;
  stats: IngestJobStats;
  files: IngestFileTask[];
  currentFileId?: string;
  limitNotice?: string;
}

export interface ActivityLogEntry {
  id: string;
  jobId: string;
  relativePath: string;
  status: 'done' | 'skipped' | 'failed' | 'running';
  summary: string;
  timestamp: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  sourcePath: string;
  mimeType: string;
  chunkCount: number;
  importedAt: string;
}

export interface IngestFolderResponse {
  jobId: string;
  rootPath: string;
  status: JobStatus;
  totalFiles: number;
  limitNotice?: string;
}

export type IngestSseEvent =
  | {
      event: 'file_started';
      data: {
        fileId: string;
        relativePath: string;
        estimatedPages?: number;
        estimatedChunks?: number;
        etaLabel?: string;
      };
    }
  | {
      event: 'file_chunk_progress';
      data: {
        fileId: string;
        relativePath: string;
        done: number;
        total: number;
        pagesDone?: number;
        pagesTotal?: number;
        reusedPages?: number;
        etaLabel?: string;
      };
    }
  | { event: 'file_done'; data: { fileId: string; relativePath: string; chunkCount: number } }
  | { event: 'file_skipped'; data: { fileId: string; relativePath: string; reason: string } }
  | { event: 'file_failed'; data: { fileId: string; relativePath: string; error: string } }
  | { event: 'job_progress'; data: { done: number; total: number; currentPath?: string } }
  | { event: 'job_done'; data: { stats: IngestJobStats; limitNotice?: string } }
  | { event: 'heartbeat'; data: Record<string, never> };
