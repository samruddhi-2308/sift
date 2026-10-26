import { Worker, type Job } from '@sift/queue';
import type { Redis } from '@sift/queue';
import { DocumentRepository } from '@sift/db';
import {
  type EmbeddingProvider,
  chunkDocument,
  EmbeddingCache,
  QdrantManager,
  type QdrantPoint,
} from '@sift/embeddings';
import { QUEUE_NAMES, type EmbedJobPayload } from '@sift/queue';
import { createLogger, type DocumentSchema } from '@sift/core';
import crypto from 'node:crypto';

const logger = createLogger('embed-worker');

/**
 * Creates a deterministic, valid UUID string from urlHash and chunkIndex
 */
export function generatePointId(urlHash: string, chunkIndex: number): string {
  const hash = crypto.createHash('md5').update(`${urlHash}:${chunkIndex}`).digest('hex');
  // Format as 8-4-4-4-12 hex UUID
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export interface EmbedWorkerOptions {
  batchSize?: number; // Batch of documents to pull from Mongo (default 50)
  maxChunksPerDoc?: number; // Cost control (default 2 chunks per doc)
}

export class EmbedService {
  private documentRepo: DocumentRepository;
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;
  private qdrant: QdrantManager;
  private maxChunksPerDoc: number;

  constructor(
    documentRepo: DocumentRepository,
    provider: EmbeddingProvider,
    cache: EmbeddingCache,
    qdrant: QdrantManager,
    options: EmbedWorkerOptions = {}
  ) {
    this.documentRepo = documentRepo;
    this.provider = provider;
    this.cache = cache;
    this.qdrant = qdrant;
    this.maxChunksPerDoc = options.maxChunksPerDoc || 2;
  }

  /**
   * Embeds a single document: chunks text, retrieves/computes embeddings, upserts to Qdrant,
   * and updates MongoDB embedding metadata. Fully idempotent.
   */
  async processDocument(
    doc: Pick<
      DocumentSchema,
      'urlHash' | 'url' | 'title' | 'text' | 'domain' | 'lang' | 'fetchedAt'
    >
  ): Promise<number> {
    const { urlHash, url, title, text, domain, lang, fetchedAt } = doc;

    // 1. Chunk document text with title prepending
    const chunks = chunkDocument(title, text, {
      maxChunksPerDoc: this.maxChunksPerDoc,
      targetTokens: 400,
      overlapTokens: 50,
    });

    if (chunks.length === 0) {
      await this.documentRepo.updateEmbeddingMeta(urlHash, {
        model: this.provider.model,
        version: this.provider.version,
        qdrantId: 'empty',
        embeddedAt: new Date(),
      });
      return 0;
    }

    // 2. Check cache for chunk embeddings
    const textsToEmbed = chunks.map((c) => c.contentToEmbed);
    const { cachedVectors, uncachedIndices } = await this.cache.getMany(
      this.provider.model,
      textsToEmbed
    );

    // 3. Generate embeddings for uncached chunks
    if (uncachedIndices.length > 0) {
      const textsNeedingEmbedding = uncachedIndices.map((i) => textsToEmbed[i]!);
      logger.debug(
        { urlHash, count: textsNeedingEmbedding.length, cached: cachedVectors.size },
        'Requesting chunk embeddings from provider'
      );

      const generatedVectors = await this.provider.embed(textsNeedingEmbedding);
      for (let j = 0; j < uncachedIndices.length; j++) {
        const origIndex = uncachedIndices[j]!;
        const vector = generatedVectors[j]!;
        cachedVectors.set(origIndex, vector);
        // Persist to cache asynchronously
        this.cache.set(this.provider.model, textsToEmbed[origIndex]!, vector).catch(() => {});
      }
    }

    // 4. Construct Qdrant points
    const points: QdrantPoint[] = [];
    const firstPointId = generatePointId(urlHash, 0);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const vector = cachedVectors.get(i);
      if (!vector) continue;

      const pointId = generatePointId(urlHash, chunk.chunkIndex);
      points.push({
        id: pointId,
        vector,
        payload: {
          urlHash,
          url,
          domain,
          lang,
          title,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          fetchedAt: (fetchedAt || new Date()).toISOString(),
        },
      });
    }

    // 5. Batch upsert points to Qdrant
    if (points.length > 0) {
      await this.qdrant.upsertPoints(points);
    }

    // 6. Update MongoDB embedding metadata (marks document as processed)
    await this.documentRepo.updateEmbeddingMeta(urlHash, {
      model: this.provider.model,
      version: this.provider.version,
      qdrantId: firstPointId,
      embeddedAt: new Date(),
    });

    return points.length;
  }

  /**
   * Scans and embeds all pending unembedded documents from MongoDB in batches
   */
  async processPendingBatch(
    batchSize = 50
  ): Promise<{ processedDocs: number; totalChunks: number }> {
    const pendingDocs = await this.documentRepo.findPendingEmbedding(batchSize);
    let totalChunks = 0;

    for (const doc of pendingDocs) {
      const chunksEmbedded = await this.processDocument(doc);
      totalChunks += chunksEmbedded;
    }

    if (pendingDocs.length > 0) {
      logger.info(
        { docs: pendingDocs.length, chunks: totalChunks, model: this.provider.model },
        'Embedded batch of pending documents'
      );
    }

    return { processedDocs: pendingDocs.length, totalChunks };
  }
}

export function createEmbedWorker(
  documentRepo: DocumentRepository,
  provider: EmbeddingProvider,
  redis: Redis,
  qdrant: QdrantManager,
  options: EmbedWorkerOptions = {}
): { worker: Worker<EmbedJobPayload>; service: EmbedService } {
  const cache = new EmbeddingCache(redis);
  const service = new EmbedService(documentRepo, provider, cache, qdrant, options);

  const worker = new Worker<EmbedJobPayload>(
    QUEUE_NAMES.EMBED,
    async (job: Job<EmbedJobPayload>) => {
      const { urlHash, title, text, domain, lang } = job.data;
      await service.processDocument({
        urlHash,
        url: '',
        title,
        text,
        domain,
        lang,
        fetchedAt: new Date(),
      });
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  return { worker, service };
}
