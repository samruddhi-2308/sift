import { QdrantClient } from '@qdrant/js-client-rest';
import { config, createLogger } from '@sift/core';
import type { QdrantChunkPayload, VectorSearchResult } from './types.js';

const logger = createLogger('qdrant-client');

export interface QdrantPoint {
  id: string; // UUID or deterministic hash string
  vector: number[];
  payload: QdrantChunkPayload;
}

export class QdrantManager {
  private client: QdrantClient;
  private collectionName: string;

  constructor(
    url = config.QDRANT_URL,
    apiKey = config.QDRANT_API_KEY,
    collectionName = config.QDRANT_COLLECTION_NAME
  ) {
    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      timeout: 5000,
      checkCompatibility: false,
    });
    this.collectionName = collectionName;
  }

  /**
   * Initializes collection with HNSW parameters and payload indexes if not already created
   */
  async ensureCollection(vectorDimension: number): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === this.collectionName);

      let needsCreation = !exists;

      if (exists) {
        try {
          const colInfo = await this.client.getCollection(this.collectionName);
          const currentSize = (colInfo.config?.params?.vectors as { size?: number })?.size;
          if (currentSize && currentSize !== vectorDimension) {
            logger.warn(
              { collection: this.collectionName, currentSize, requiredSize: vectorDimension },
              'Qdrant collection dimension mismatch; recreating collection for new embedding model'
            );
            await this.client.deleteCollection(this.collectionName);
            needsCreation = true;
          }
        } catch {
          // If inspection fails, fallback to using existing
        }
      }

      if (needsCreation) {
        logger.info(
          { collection: this.collectionName, dimension: vectorDimension },
          'Creating Qdrant collection with HNSW index (m=16, ef_construct=128)'
        );

        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: vectorDimension,
            distance: 'Cosine',
          },
          hnsw_config: {
            m: 16,
            ef_construct: 128,
          },
        });

        // Create payload indexes for domain and lang filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'domain',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'lang',
          field_schema: 'keyword',
        });

        logger.info(
          { collection: this.collectionName },
          'Qdrant collection and payload indexes created'
        );
      } else {
        logger.debug({ collection: this.collectionName }, 'Qdrant collection already exists with matching dimension');
      }
    } catch (err) {
      logger.error({ err, collection: this.collectionName }, 'Failed ensuring Qdrant collection');
      throw err;
    }
  }

  /**
   * Upserts a batch of vector points with payloads into Qdrant
   */
  async upsertPoints(points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) return;

    await this.client.upsert(this.collectionName, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  /**
   * Vector similarity search with cosine distance and optional domain/language filters
   */
  async search(
    queryVector: number[],
    options: {
      limit?: number;
      domain?: string;
      lang?: string;
      scoreThreshold?: number;
    } = {}
  ): Promise<VectorSearchResult[]> {
    const limit = options.limit || 100;
    const mustFilters: Array<Record<string, unknown>> = [];

    if (options.domain) {
      mustFilters.push({
        key: 'domain',
        match: { value: options.domain },
      });
    }

    if (options.lang) {
      mustFilters.push({
        key: 'lang',
        match: { value: options.lang },
      });
    }

    const filter = mustFilters.length > 0 ? { must: mustFilters } : undefined;

    const res = await this.client.query(this.collectionName, {
      query: queryVector,
      limit,
      filter,
      score_threshold: options.scoreThreshold,
      with_payload: true,
    });

    return (res.points || []).map((p) => ({
      id: p.id,
      score: p.score ?? 0,
      payload: (p.payload || {}) as unknown as QdrantChunkPayload,
    }));
  }

  /**
   * Health check ping
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.client.getCollections();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}
