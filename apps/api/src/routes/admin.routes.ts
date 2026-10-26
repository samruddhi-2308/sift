import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '@sift/db';
import { getDocumentsCollection, getAgentRunsCollection, DLQRepository } from '@sift/db';
import { getQueue, QUEUE_NAMES, type FetchJobPayload } from '@sift/queue';
import type { ErrorClassification } from '@sift/core';

export interface AdminRoutesOptions {
  db: Db;
}

export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const { db } = opts;
  const dlqRepo = new DLQRepository(db);

  // 1. Overall System Stats
  app.get('/admin/stats', async (_req, reply) => {
    const docsCol = getDocumentsCollection(db);
    const agentCol = getAgentRunsCollection(db);

    const [totalDocs, unembeddedDocs, distinctDomains, totalAgentRuns, dlqCounts] =
      await Promise.all([
        docsCol.estimatedDocumentCount().catch(() => 0),
        docsCol.countDocuments({ embedding: null }).catch(() => 0),
        docsCol.distinct('domain').then((d) => d.length).catch(() => 0),
        agentCol.countDocuments().catch(() => 0),
        dlqRepo.countByErrorClass().catch(() => ({})),
      ]);

    const embeddedDocs = Math.max(0, totalDocs - unembeddedDocs);

    return reply.send({
      totalDocuments: totalDocs,
      embeddedDocuments: embeddedDocs,
      unembeddedDocuments: unembeddedDocs,
      totalDomains: distinctDomains,
      totalAgentRuns,
      dlqCounts,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Queue Depths across all BullMQ queues
  app.get('/admin/queues', async (_req, reply) => {
    const queueNames = [
      QUEUE_NAMES.FETCH,
      QUEUE_NAMES.PARSE,
      QUEUE_NAMES.INGEST,
      QUEUE_NAMES.EMBED,
      QUEUE_NAMES.RENDER,
      QUEUE_NAMES.DLQ,
    ];

    const results = await Promise.all(
      queueNames.map(async (name) => {
        try {
          const q = getQueue(name);
          const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
          return {
            name,
            waiting: counts.waiting,
            active: counts.active,
            completed: counts.completed,
            failed: counts.failed,
            delayed: counts.delayed,
          };
        } catch {
          return {
            name,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
          };
        }
      })
    );

    return reply.send({ queues: results, timestamp: new Date().toISOString() });
  });

  // 3. DLQ Failed Jobs Listing
  app.get('/admin/dlq', async (req, reply) => {
    const query = req.query as { class?: string; limit?: string };
    const errorClass = query.class as ErrorClassification | undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    const jobs = await dlqRepo.getPendingReplays(errorClass, limit);
    return reply.send({
      jobs,
      count: jobs.length,
    });
  });

  // 4. DLQ Replay Trigger
  app.post('/admin/dlq/replay', async (req, reply) => {
    const body = (req.body || {}) as { errorClass?: string; limit?: number };
    const errorClass = body.errorClass as ErrorClassification | undefined;
    const limit = body.limit || 50;

    const pending = await dlqRepo.getPendingReplays(errorClass, limit);
    if (pending.length === 0) {
      return reply.send({ replayedCount: 0, message: 'No matching DLQ jobs to replay.' });
    }

    const fetchQueue = getQueue<FetchJobPayload>(QUEUE_NAMES.FETCH);
    const jobIds: string[] = [];

    for (const job of pending) {
      const payload = job.payload as unknown as FetchJobPayload;
      if (payload && payload.url) {
        await fetchQueue.add(
          'fetch-url',
          {
            url: payload.url,
            depth: payload.depth || 0,
            domain: payload.domain || '',
            referrer: payload.referrer,
            retryCount: (payload.retryCount || 0) + 1,
          },
          {
            jobId: `replay-${job.jobId}-${Date.now()}`,
            removeOnComplete: true,
          }
        );
        jobIds.push(job.jobId);
      }
    }

    const marked = await dlqRepo.markReplayed(jobIds);
    return reply.send({
      replayedCount: marked,
      jobIds,
      message: `Successfully re-enqueued ${marked} failed jobs to fetch queue.`,
    });
  });

  // 5. Agent Traces List
  app.get('/admin/traces', async (req, reply) => {
    const query = req.query as { limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 30;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    const agentCol = getAgentRunsCollection(db);
    const runs = await agentCol
      .find({})
      .sort({ startedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return reply.send(runs);
  });

  // 6. Single Agent Trace Lookup
  app.get('/admin/traces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const agentCol = getAgentRunsCollection(db);
    const run = await agentCol.findOne({ runId: id });
    if (!run) {
      return reply.status(404).send({ error: 'Agent run trace not found' });
    }
    return reply.send(run);
  });
};
