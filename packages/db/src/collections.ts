import type { Collection, Db } from 'mongodb';
import type { DocumentSchema, FrontierDomainState, DLQJobRecord } from '@sift/core';

export const COLLECTIONS = {
  DOCUMENTS: 'documents',
  FRONTIER_STATE: 'frontier_state',
  DLQ_JOBS: 'dlq_jobs',
  AGENT_RUNS: 'agent_runs',
  EVAL_RUNS: 'eval_runs',
  LINKS: 'links',
} as const;

export function getDocumentsCollection(db: Db): Collection<DocumentSchema> {
  return db.collection<DocumentSchema>(COLLECTIONS.DOCUMENTS);
}

export function getFrontierCollection(db: Db): Collection<FrontierDomainState> {
  return db.collection<FrontierDomainState>(COLLECTIONS.FRONTIER_STATE);
}

export function getDLQCollection(db: Db): Collection<DLQJobRecord> {
  return db.collection<DLQJobRecord>(COLLECTIONS.DLQ_JOBS);
}
