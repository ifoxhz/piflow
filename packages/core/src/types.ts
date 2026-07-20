export type ParserBackend = 'native' | 'pdf-oxide' | 'docling';

export type AppView = 'welcome' | 'chat' | 'knowledge' | 'settings';

export interface Document {
  id: string;
  title: string;
  sourcePath: string;
  mimeType: string;
  parserBackend: ParserBackend;
  pageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChunkMetadata {
  page?: number;
  heading?: string;
  charOffset: number;
  bbox?: [number, number, number, number];
  parserBackend?: ParserBackend;
  blockType?: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  citations?: Citation[];
}

export interface Citation {
  sourceId: string;
  quote: string;
  documentId: string;
  documentTitle: string;
  sourcePath?: string;
  chunkId: string;
  /** 1-based page number when available (e.g. PDF import). */
  page?: number;
  /** Nearest section heading from chunk metadata. */
  heading?: string;
}

export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summarize',
    label: 'Summarize documents',
    prompt: 'Summarize the key points from my knowledge base documents.',
  },
  {
    id: 'search',
    label: 'Search knowledge base',
    prompt: 'Search my knowledge base for relevant information about ',
  },
  {
    id: 'pdf-qa',
    label: 'Q&A from PDF',
    prompt: 'Answer questions based on the PDF documents in my knowledge base.',
  },
  {
    id: 'analyze',
    label: 'Analyze data',
    prompt: 'Analyze the data and trends described in my documents.',
  },
];

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  ragServer: boolean;
  models?: Array<{
    id: string;
    status: 'ready' | 'missing' | 'incomplete' | 'downloading' | 'error';
    missingFiles?: string[];
  }>;
}
