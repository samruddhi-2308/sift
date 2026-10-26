import type { Db, Collection, Filter } from 'mongodb';
import { getDLQCollection } from '../collections.js';
import type { DLQJobRecord, ErrorClassification } from '@sift/core';

export class DLQRepository {
  private collection: Collection<DLQJobRecord>;

  constructor(db: Db) {
    this.collection = getDLQCollection(db);
  }

  async recordFailure(job: Omit<DLQJobRecord, 'replayed'>): Promise<void> {
    await this.collection.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          ...job,
          replayed: false,
        },
      },
      { upsert: true }
    );
  }

  async getPendingReplays(errorClass?: ErrorClassification, limit = 100): Promise<DLQJobRecord[]> {
    const filter: Filter<DLQJobRecord> = { replayed: false };
    if (errorClass) {
      filter.errorClass = errorClass;
    }

    return this.collection.find(filter).sort({ failedAt: -1 }).limit(limit).toArray();
  }

  async markReplayed(jobIds: string[]): Promise<number> {
    const result = await this.collection.updateMany(
      { jobId: { $in: jobIds } },
      {
        $set: {
          replayed: true,
          replayedAt: new Date(),
        },
      }
    );
    return result.modifiedCount;
  }

  async countByErrorClass(): Promise<Record<string, number>> {
    const pipeline = [
      { $match: { replayed: false } },
      { $group: { _id: '$errorClass', count: { $sum: 1 } } },
    ];
    const results = await this.collection.aggregate(pipeline).toArray();
    const map: Record<string, number> = {};
    for (const r of results) {
      map[r._id as string] = r.count as number;
    }
    return map;
  }
}
