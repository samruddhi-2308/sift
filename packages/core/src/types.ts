export type RenderMode = 'static' | 'rendered' | 'agent';

export type DocumentSource = 'crawl' | 'wikipedia' | 'commoncrawl' | 'other';

export interface DocumentEmbeddingMeta {
  model: string;
  version: number;
  qdrantId: string;
  embeddedAt: Date;
}

export interface DocumentSchema {
  urlHash: string; // xxhash64 or sha256 hex string of normalized URL
  url: string;
  canonicalUrl?: string;
  domain: string;
  title: string;
  text: string;
  textLength: number;
  headings: string[];
  lang: string;
  contentHash: string; // SimHash for near-duplicate detection
  outlinks: number;
  fetchedAt: Date;
  httpStatus: number;
  renderMode: RenderMode;
  source: DocumentSource;
  embedding: DocumentEmbeddingMeta | null;
  schemaVersion: number;
}

export type ErrorClassification =
  | 'dns'
  | 'timeout'
  | 'blocked'
  | 'parse'
  | 'too_large'
  | 'rate_limited'
  | 'not_found'
  | 'server_error'
  | 'other';

export interface DLQJobRecord {
  jobId: string;
  queueName: string;
  payload: Record<string, unknown>;
  errorClass: ErrorClassification;
  errorMessage: string;
  stackTrace?: string;
  failedAt: Date;
  attempts: number;
  replayed: boolean;
  replayedAt?: Date;
}

export interface FrontierDomainState {
  domain: string;
  lastFetchAt: Date;
  crawlDelayMs: number;
  robotsTxtCachedAt?: Date;
  robotsTxtHash?: string;
  errorCount: number;
  successCount: number;
  isBlocked: boolean;
}

// -------------------------------------------------------------
// Phase 5: Browser Agent Types
// -------------------------------------------------------------

export type AgentActionName =
  | 'click'
  | 'type'
  | 'scroll'
  | 'wait_for'
  | 'go_back'
  | 'extract'
  | 'finish';

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

export interface AgentObservation {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  contentSummary: string;
  scrollPosition: { x: number; y: number; maxY: number };
}

export interface AgentActionPayload {
  name: AgentActionName;
  args: Record<string, unknown>;
  thought?: string;
}

export interface AgentStepRecord {
  stepNumber: number;
  timestamp: Date;
  url: string;
  title: string;
  observation: AgentObservation;
  action: AgentActionPayload;
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

export type AgentRunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'budget_exceeded'
  | 'validation_failed'
  | 'timeout';

export interface AgentRunRecord {
  runId: string;
  url: string;
  goal: string;
  schema?: Record<string, unknown>;
  status: AgentRunStatus;
  steps: AgentStepRecord[];
  extraction?: unknown;
  validationErrors?: string[];
  validationRetries: number;
  totalTokens: number;
  estimatedCostUsd: number;
  startedAt: Date;
  completedAt?: Date;
  durationMs: number;
  error?: string;
}

export interface AgentGoalInput {
  url: string;
  goal: string;
  schema?: Record<string, unknown>;
  maxSteps?: number;
  tokenBudget?: number;
  timeoutMs?: number;
  allowedDomains?: string[];
  headless?: boolean;
}

