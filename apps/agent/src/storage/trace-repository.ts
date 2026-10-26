import { getAgentRunsCollection, type Db } from '@sift/db';
import type { AgentRunRecord } from '../types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('trace-repository');

export class TraceRepository {
  private db?: Db;
  private memoryStore: Map<string, AgentRunRecord> = new Map();

  constructor(db?: Db) {
    this.db = db;
  }

  async saveRun(record: AgentRunRecord): Promise<void> {
    this.memoryStore.set(record.runId, record);

    if (this.db) {
      try {
        const col = getAgentRunsCollection(this.db);
        await col.updateOne(
          { runId: record.runId },
          { $set: record },
          { upsert: true }
        );
        logger.info({ runId: record.runId, status: record.status }, 'Saved agent run trace to MongoDB');
      } catch (err) {
        logger.error({ err, runId: record.runId }, 'Failed saving agent run trace to MongoDB; kept in memory');
      }
    }
  }

  async getRun(runId: string): Promise<AgentRunRecord | null> {
    if (this.db) {
      try {
        const col = getAgentRunsCollection(this.db);
        const record = await col.findOne({ runId });
        if (record) return record;
      } catch (err) {
        logger.warn({ err, runId }, 'Failed querying agent run from MongoDB, checking memory store');
      }
    }

    return this.memoryStore.get(runId) ?? null;
  }

  async listRecentRuns(limit = 50, offset = 0): Promise<AgentRunRecord[]> {
    if (this.db) {
      try {
        const col = getAgentRunsCollection(this.db);
        const records = await col
          .find({})
          .sort({ startedAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray();
        return records;
      } catch (err) {
        logger.warn({ err }, 'Failed listing agent runs from MongoDB, returning memory store');
      }
    }

    return Array.from(this.memoryStore.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(offset, offset + limit);
  }
}
