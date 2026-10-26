import type { Queue } from '@sift/queue';
import type { DLQRepository } from '@sift/db';
import type { DLQJobPayload, FetchJobPayload } from '@sift/queue';
import { createLogger, type ErrorClassification, dlqJobsTotal } from '@sift/core';

const logger = createLogger('dlq-handler');

export class DLQHandler {
  private dlqRepository: DLQRepository;
  private fetchQueue: Queue<FetchJobPayload>;

  constructor(dlqRepository: DLQRepository, fetchQueue: Queue<FetchJobPayload>) {
    this.dlqRepository = dlqRepository;
    this.fetchQueue = fetchQueue;
  }

  /**
   * Persists a failed job to the DLQ repository and metrics counter
   */
  async handleFailure(payload: DLQJobPayload, jobId: string): Promise<void> {
    logger.warn(
      {
        jobId,
        originalQueue: payload.originalQueue,
        errorClass: payload.errorClass,
        message: payload.errorMessage,
        attempts: payload.attempts,
      },
      'Moving failed job to Dead Letter Queue'
    );

    dlqJobsTotal.inc({ error_class: payload.errorClass });

    await this.dlqRepository.recordFailure({
      jobId,
      queueName: payload.originalQueue,
      payload: payload.originalPayload,
      errorClass: payload.errorClass,
      errorMessage: payload.errorMessage,
      stackTrace: payload.stack,
      failedAt: new Date(payload.failedAt),
      attempts: payload.attempts,
    });
  }

  /**
   * Replays failed DLQ jobs back to the fetch queue
   */
  async replay(
    errorClass?: ErrorClassification,
    limit = 100
  ): Promise<{ replayedCount: number; jobIds: string[] }> {
    const jobs = await this.dlqRepository.getPendingReplays(errorClass, limit);
    const jobIds: string[] = [];

    for (const job of jobs) {
      if (job.payload && typeof job.payload['url'] === 'string') {
        const fetchPayload = job.payload as unknown as FetchJobPayload;
        await this.fetchQueue.add('fetch-page', fetchPayload, {
          priority: 50,
          attempts: 3,
        });
        jobIds.push(job.jobId);
      }
    }

    if (jobIds.length > 0) {
      await this.dlqRepository.markReplayed(jobIds);
      logger.info({ count: jobIds.length, errorClass }, 'Replayed DLQ jobs back into fetch queue');
    }

    return { replayedCount: jobIds.length, jobIds };
  }
}
