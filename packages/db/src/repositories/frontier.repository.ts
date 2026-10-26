import type { Db, Collection } from 'mongodb';
import { getFrontierCollection } from '../collections.js';
import type { FrontierDomainState } from '@sift/core';

export class FrontierRepository {
  private collection: Collection<FrontierDomainState>;

  constructor(db: Db) {
    this.collection = getFrontierCollection(db);
  }

  async getDomainState(domain: string): Promise<FrontierDomainState | null> {
    return this.collection.findOne({ domain });
  }

  async upsertDomainState(state: FrontierDomainState): Promise<void> {
    await this.collection.updateOne({ domain: state.domain }, { $set: state }, { upsert: true });
  }

  async recordCrawlResult(domain: string, isSuccess: boolean, delayMs = 1000): Promise<void> {
    await this.collection.updateOne(
      { domain },
      {
        $set: {
          lastFetchAt: new Date(),
          crawlDelayMs: delayMs,
        },
        $inc: {
          successCount: isSuccess ? 1 : 0,
          errorCount: isSuccess ? 0 : 1,
        },
        $setOnInsert: {
          domain,
          isBlocked: false,
        },
      },
      { upsert: true }
    );
  }
}
