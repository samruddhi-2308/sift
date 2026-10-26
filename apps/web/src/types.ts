export type SearchMode = 'keyword' | 'vector' | 'hybrid' | 'hybrid_rerank';

export interface SearchResultItem {
  documentId: string;
  url: string;
  urlHash: string;
  domain: string;
  title: string;
  snippet: string;
  score: number;
  keywordRank?: number;
  vectorRank?: number;
  rrfScore?: number;
  rerankScore?: number;
  matchedTerms?: string[];
  source: string;
  fetchedAt: string;
}

export interface SearchStageTiming {
  embedMs?: number;
  keywordMs?: number;
  vectorMs?: number;
  fusionMs?: number;
  rerankMs?: number;
  totalMs: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  mode: SearchMode;
  results: SearchResultItem[];
  timing: SearchStageTiming;
  degraded?: boolean;
  degradationReason?: string;
}

export interface SearchCompareResponse {
  query: string;
  timing: SearchStageTiming;
  modes: {
    keyword: SearchResultItem[];
    vector: SearchResultItem[];
    hybrid: SearchResultItem[];
    hybrid_rerank: SearchResultItem[];
  };
}

export interface AdminStats {
  totalDocuments: number;
  embeddedDocuments: number;
  unembeddedDocuments: number;
  totalDomains: number;
  totalAgentRuns: number;
  dlqCounts: Record<string, number>;
  timestamp: string;
}

export interface QueueCountItem {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface QueueDepthsResponse {
  queues: QueueCountItem[];
  timestamp: string;
}

export interface DlqJobItem {
  _id?: string;
  jobId: string;
  queueName: string;
  payload: Record<string, any>;
  errorClass: string;
  errorMessage: string;
  stackTrace?: string;
  failedAt: string;
  attempts: number;
  replayed: boolean;
  replayedAt?: string;
}

export interface DlqResponse {
  jobs: DlqJobItem[];
  count: number;
}

export interface InteractiveElement {
  id: number;
  tag: string;
  role?: string;
  text: string;
  selector?: string;
  type?: string;
  href?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}

export interface AgentStepRecord {
  stepNumber: number;
  timestamp: string;
  url: string;
  title: string;
  observation: {
    url: string;
    title: string;
    interactiveElements: InteractiveElement[];
    contentSummary: string;
    scrollPosition?: { x: number; y: number; maxY: number };
  };
  action: {
    name: string;
    args: Record<string, any>;
    thought?: string;
  };
  actionResult: {
    success: boolean;
    message: string;
    validationErrors?: string[];
  };
  screenshotBase64?: string;
  tokens?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs: number;
}

export interface AgentTraceItem {
  _id?: string;
  runId: string;
  url: string;
  goal: string;
  schema?: Record<string, any>;
  status: 'running' | 'success' | 'failed' | 'budget_exceeded' | 'validation_failed' | 'timeout';
  steps: AgentStepRecord[];
  extraction?: any;
  validationRetries: number;
  totalTokens: number;
  estimatedCostUsd: number;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  error?: string;
}
