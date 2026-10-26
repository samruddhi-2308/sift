import type { Db, CreateIndexesOptions, IndexSpecification } from 'mongodb';
import { COLLECTIONS } from './collections.js';
import { createLogger } from '@sift/core';

const logger = createLogger('db-indexes');

export interface IndexDefinition {
  collection: string;
  spec: IndexSpecification;
  options: CreateIndexesOptions;
  description: string;
}

export const REQUIRED_INDEXES: IndexDefinition[] = [
  // 1. Unique URL hash for O(1) deduplication and idempotent upserts
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: { urlHash: 1 },
    options: { unique: true, name: 'uniq_url_hash' },
    description: 'Unique URL hash for deduplication and point lookups',
  },
  // 2. Compound domain and recency index
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: { domain: 1, fetchedAt: -1 },
    options: { name: 'idx_domain_fetched_at' },
    description: 'Compound index for per-domain recency queries',
  },
  // 3. SimHash index for near-duplicate clustering
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: { contentHash: 1 },
    options: { name: 'idx_content_hash' },
    description: 'SimHash index for detecting near-duplicate pages',
  },
  // 4. Sparse Qdrant vector mapping index
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: { 'embedding.qdrantId': 1 },
    options: { sparse: true, name: 'sparse_embedding_qdrant_id' },
    description: 'Sparse index for mapping Mongo documents to Qdrant vector points',
  },
  // 5. Partial index for scanning un-embedded documents efficiently
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: { embedding: 1, _id: 1 },
    options: {
      partialFilterExpression: { embedding: null },
      name: 'partial_unembedded_scan',
    },
    description: 'Partial index scanning documents pending vector embedding',
  },
  // 6. Full-text search index with weighted fields
  {
    collection: COLLECTIONS.DOCUMENTS,
    spec: {
      title: 'text',
      headings: 'text',
      text: 'text',
    },
    options: {
      weights: {
        title: 10,
        headings: 5,
        text: 1,
      },
      name: 'text_search_weighted',
      default_language: 'english',
    },
    description: 'Weighted text search index (title:10, headings:5, text:1)',
  },
  // Frontier state index
  {
    collection: COLLECTIONS.FRONTIER_STATE,
    spec: { domain: 1 },
    options: { unique: true, name: 'uniq_frontier_domain' },
    description: 'Unique index on frontier domain state',
  },
  // DLQ jobs compound index
  {
    collection: COLLECTIONS.DLQ_JOBS,
    spec: { errorClass: 1, replayed: 1, failedAt: -1 },
    options: { name: 'idx_dlq_replay_lookup' },
    description: 'Index for querying un-replayed DLQ jobs by error class',
  },
  // Agent runs indexes
  {
    collection: COLLECTIONS.AGENT_RUNS,
    spec: { runId: 1 },
    options: { unique: true, name: 'uniq_agent_run_id' },
    description: 'Unique index on agent run identifier for fast trace lookup',
  },
  {
    collection: COLLECTIONS.AGENT_RUNS,
    spec: { startedAt: -1, status: 1 },
    options: { name: 'idx_agent_runs_recent' },
    description: 'Index for querying recent agent runs and status',
  },
];


export async function createAllIndexes(db: Db): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const def of REQUIRED_INDEXES) {
    const col = db.collection(def.collection);
    try {
      const indexName = await col.createIndex(def.spec, def.options);
      created.push(`${def.collection}.${indexName}`);
      logger.info(
        { collection: def.collection, index: indexName },
        `Ensured index: ${def.description}`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already exists') || message.includes('existing index')) {
        existing.push(`${def.collection}.${def.options.name || 'unnamed'}`);
      } else {
        logger.error({ err, def }, `Failed creating index on ${def.collection}`);
        throw err;
      }
    }
  }

  return { created, existing };
}
