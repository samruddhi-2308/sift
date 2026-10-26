import type { ErrorClassification, RenderMode, DocumentSchema } from '@sift/core';

export const QUEUE_NAMES = {
  FETCH: 'sift-fetch',
  PARSE: 'sift-parse',
  RENDER: 'sift-render',
  INGEST: 'sift-ingest',
  EMBED: 'sift-embed',
  DLQ: 'sift-dlq',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface FetchJobPayload {
  url: string;
  depth: number;
  domain: string;
  referrer?: string;
  retryCount?: number;
}

export interface ParseJobPayload {
  url: string;
  urlHash: string;
  domain: string;
  html: string;
  httpStatus: number;
  fetchedAt: string;
  renderMode: RenderMode;
  depth: number;
}

export interface IngestJobPayload {
  document: DocumentSchema;
}

export interface EmbedJobPayload {
  urlHash: string;
  title: string;
  text: string;
  domain: string;
  lang: string;
}

export interface DLQJobPayload {
  originalQueue: string;
  originalPayload: Record<string, unknown>;
  errorClass: ErrorClassification;
  errorMessage: string;
  stack?: string;
  failedAt: string;
  attempts: number;
}
