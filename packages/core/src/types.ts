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
