import { Worker, type Job, type Queue } from '@sift/queue';
import type { Redis } from '@sift/queue';
import { DocumentRepository } from '@sift/db';
import { QUEUE_NAMES, type IngestJobPayload, type FetchJobPayload } from '@sift/queue';
import { createLogger, type DocumentSchema } from '@sift/core';

const logger = createLogger('ingest-worker');

export interface IngestWorkerOptions {
  batchSize?: number; // Default 1000
  flushIntervalMs?: number; // Default 2000 (2s)
  maxTextLength?: number; // Default 50000 chars
  highWaterMark?: number; // Pause upstream when queue depth exceeds this
  lowWaterMark?: number; // Resume upstream when queue depth drops below this
}

export class BatchIngestManager {
  private documentRepo: DocumentRepository;
  private batch: DocumentSchema[] = [];
  private jobResolvers: Array<() => void> = [];
  private jobRejectors: Array<(err: Error) => void> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private batchSize: number;
  private flushIntervalMs: number;
  private maxTextLength: number;

  constructor(documentRepo: DocumentRepository, options: IngestWorkerOptions = {}) {
    this.documentRepo = documentRepo;
    this.batchSize = options.batchSize || 1000;
    this.flushIntervalMs = options.flushIntervalMs || 2000;
    this.maxTextLength = options.maxTextLength || 50000;
  }

  start(): void {
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        if (this.batch.length > 0 && !this.isFlushing) {
          this.flush().catch((err) => {
            logger.error({ err }, 'Periodic flush failed');
          });
        }
      }, this.flushIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.batch.length > 0) {
      await this.flush();
    }
  }

  async addDocument(doc: DocumentSchema): Promise<void> {
    // Truncate stored text to max length if needed (keeps storage compact and bounds memory)
    const sanitizedDoc: DocumentSchema = {
      ...doc,
      text: doc.text.length > this.maxTextLength ? doc.text.slice(0, this.maxTextLength) : doc.text,
      textLength: Math.min(doc.textLength, this.maxTextLength),
    };

    return new Promise<void>((resolve, reject) => {
      this.batch.push(sanitizedDoc);
      this.jobResolvers.push(resolve);
      this.jobRejectors.push(reject);

      if (this.batch.length >= this.batchSize && !this.isFlushing) {
        this.flush().catch((err) => {
          logger.error({ err }, 'Batch-size triggered flush failed');
        });
      }
    });
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.batch.length === 0) return;
    this.isFlushing = true;

    const docsToFlush = [...this.batch];
    const resolvers = [...this.jobResolvers];
    const rejectors = [...this.jobRejectors];

    this.batch = [];
    this.jobResolvers = [];
    this.jobRejectors = [];

    const startTime = Date.now();
    try {
      logger.info({ count: docsToFlush.length }, 'Flushing batch write to MongoDB...');
      const result = await this.documentRepo.bulkUpsert(docsToFlush);
      const durationMs = Date.now() - startTime;

      logger.info(
        {
          count: docsToFlush.length,
          upserted: result.upsertedCount,
          modified: result.modifiedCount,
          durationMs,
          docsPerSec: Math.round((docsToFlush.length / durationMs) * 1000),
        },
        'Batch write completed successfully'
      );

      // Resolve all awaiting jobs in this batch
      for (const res of resolvers) res();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ err: error.message }, 'Bulk write batch failed');
      for (const rej of rejectors) rej(error);
    } finally {
      this.isFlushing = false;
    }
  }

  get currentBatchSize(): number {
    return this.batch.length;
  }
}

export function createIngestWorker(
  documentRepo: DocumentRepository,
  redis: Redis,
  fetchQueue?: Queue<FetchJobPayload>,
  ingestQueue?: Queue<IngestJobPayload>,
  options: IngestWorkerOptions = {}
): { worker: Worker<IngestJobPayload>; manager: BatchIngestManager } {
  const manager = new BatchIngestManager(documentRepo, options);
  manager.start();

  const highWaterMark = options.highWaterMark || 10000;
  const lowWaterMark = options.lowWaterMark || 2000;
  let isBackpressureActive = false;

  const worker = new Worker<IngestJobPayload>(
    QUEUE_NAMES.INGEST,
    async (job: Job<IngestJobPayload>) => {
      const { document } = job.data;

      // Check backpressure against ingest queue depth
      if (fetchQueue && ingestQueue && job.id && Number(job.id) % 100 === 0) {
        try {
          const waitingCount = await ingestQueue.getWaitingCount();
          if (waitingCount > highWaterMark && !isBackpressureActive) {
            isBackpressureActive = true;
            logger.warn(
              { waitingCount, highWaterMark },
              'Ingest queue exceeded high watermark; pausing fetch queue'
            );
            await fetchQueue.pause();
          } else if (waitingCount < lowWaterMark && isBackpressureActive) {
            isBackpressureActive = false;
            logger.info(
              { waitingCount, lowWaterMark },
              'Ingest queue cleared low watermark; resuming fetch queue'
            );
            await fetchQueue.resume();
          }
        } catch {
          // ignore backpressure query error
        }
      }

      await manager.addDocument(document);
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  return { worker, manager };
}
