export type ParserBackend = 'native' | 'pdf-oxide' | 'pp-ocr' | 'docling';

export type AppView = 'welcome' | 'chat' | 'knowledge' | 'piFlow' | 'settings';

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
  /** Present on assistant turns when reRAG plan was returned. */
  retrievalPlan?: RetrievalPlan;
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

/** Intent for reRAG retrieval planning (docs/reRAG.md). */
export type RetrievalIntent =
  | 'fact'
  | 'enumerate'
  | 'explain'
  | 'compare'
  | 'locate'
  | 'summarize'
  | 'other';

/** Structured plan produced before vector search. */
export interface RetrievalPlan {
  intent: RetrievalIntent;
  /** 1–5 queries for dense embedding search (prefer 2–4; enumerate/compare up to 5). */
  denseQueries: string[];
  /** Proper nouns / terms; MVP: log & return only, no scoring. */
  keywords: string[];
  /** Short generation-side constraint (from intent template). */
  answerHint: string;
  /** Matched generic intent template id (reRAG template router). */
  templateId?: string;
  /** Cosine score of best exemplar match for templateId. */
  templateScore?: number;
  /** True when exemplar match was below BLUELAMP_TEMPLATE_SCORE_MIN (conservative hint/recipe). */
  lowConfidence?: boolean;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  reply: string;
  citations: Citation[];
  retrievalPlan: RetrievalPlan;
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

/** Runtime Ollama generation settings (rag-server). */
export interface OllamaConfig {
  url: string;
  model: string;
  modelZh: string;
}

export interface OllamaConfigResponse extends OllamaConfig {
  configured: boolean;
  reachable: boolean;
}

/** Active LLM provider for piFlow (Settings → 模型配置). */
export type LlmProvider = 'ollama' | 'deepseek';

export interface LlmConfigResponse {
  provider: LlmProvider;
  ollama: OllamaConfigResponse;
  deepseek: {
    /** Always empty from API — never prefill secrets into the form. */
    apiKey: '';
    model: string;
    baseUrl: string;
    apiKeySet: boolean;
    configured: boolean;
  };
}

export interface LlmConfigUpdate {
  provider?: LlmProvider;
  ollama?: Partial<OllamaConfig>;
  deepseek?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
}
