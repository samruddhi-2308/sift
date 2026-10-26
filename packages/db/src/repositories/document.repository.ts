import type { Db, Collection, AnyBulkWriteOperation, Document } from 'mongodb';
import { getDocumentsCollection } from '../collections.js';
import type { DocumentSchema, DocumentEmbeddingMeta } from '@sift/core';

export class DocumentRepository {
  private collection: Collection<DocumentSchema>;

  constructor(db: Db) {
    this.collection = getDocumentsCollection(db);
  }

  /**
   * Upsert a single document by urlHash
   */
  async upsert(doc: DocumentSchema): Promise<void> {
    await this.collection.updateOne({ urlHash: doc.urlHash }, { $set: doc }, { upsert: true });
  }

  /**
   * Bulk upsert in batches (ordered: false for max performance)
   */
  async bulkUpsert(
    docs: DocumentSchema[]
  ): Promise<{ upsertedCount: number; modifiedCount: number }> {
    if (docs.length === 0) {
      return { upsertedCount: 0, modifiedCount: 0 };
    }

    const operations: AnyBulkWriteOperation<DocumentSchema>[] = docs.map((doc) => ({
      updateOne: {
        filter: { urlHash: doc.urlHash },
        update: { $set: doc },
        upsert: true,
      },
    }));

    const result = await this.collection.bulkWrite(operations, { ordered: false });
    return {
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  /**
   * Point lookup by urlHash (designed for p95 < 5ms latency)
   */
  async findByUrlHash(urlHash: string): Promise<DocumentSchema | null> {
    return this.collection.findOne({ urlHash });
  }

  /**
   * Compound domain + recency lookup
   */
  async findByDomain(domain: string, limit = 50, skip = 0): Promise<DocumentSchema[]> {
    return this.collection
      .find({ domain })
      .sort({ fetchedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  /**
   * Query documents pending embedding using partial index
   */
  async findPendingEmbedding(batchSize = 100): Promise<DocumentSchema[]> {
    return this.collection
      .find({ embedding: null })
      .project<DocumentSchema>({
        urlHash: 1,
        url: 1,
        title: 1,
        text: 1,
        headings: 1,
        domain: 1,
        lang: 1,
        fetchedAt: 1,
      })
      .limit(batchSize)
      .toArray();
  }

  /**
   * Update embedding metadata after Qdrant upsert
   */
  async updateEmbeddingMeta(urlHash: string, embedding: DocumentEmbeddingMeta): Promise<boolean> {
    const result = await this.collection.updateOne({ urlHash }, { $set: { embedding } });
    return result.modifiedCount > 0;
  }

  /**
   * Weighted MongoDB full-text keyword search
   */
  async searchKeyword(
    query: string,
    limit = 100,
    skip = 0
  ): Promise<Array<DocumentSchema & { score: number }>> {
    return this.collection
      .find({ $text: { $search: query } }, { projection: { score: { $meta: 'textScore' } } })
      .sort({ score: { $meta: 'textScore' } })
      .skip(skip)
      .limit(limit)
      .toArray() as unknown as Promise<Array<DocumentSchema & { score: number }>>;
  }

  /**
   * Explain query plan for hot queries
   */
  async explainPointLookup(urlHash: string): Promise<Document> {
    return this.collection.find({ urlHash }).explain('executionStats');
  }

  /**
   * Explain query plan for domain recency
   */
  async explainDomainRecency(domain: string): Promise<Document> {
    return this.collection
      .find({ domain })
      .sort({ fetchedAt: -1 })
      .limit(50)
      .explain('executionStats');
  }

  /**
   * Total count of indexed documents
   */
  async count(filter: Partial<DocumentSchema> = {}): Promise<number> {
    return this.collection.countDocuments(filter as Filter<DocumentSchema>);
  }
}
import type { Filter } from 'mongodb';
