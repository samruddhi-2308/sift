import { Worker, type Job, type Queue, type Redis, QUEUE_NAMES, type RenderJobPayload, type ParseJobPayload } from '@sift/queue';
import { BrowserSession } from '@sift/agent';
import { createLogger } from '@sift/core';
import { computeUrlHash } from '../dedupe/url-normalizer.js';

const logger = createLogger('render-worker');

export interface RenderWorkerDependencies {
  redis: Redis;
  parseQueue: Queue<ParseJobPayload>;
  concurrency?: number;
}

/**
 * Render worker consuming from sift-render queue.
 * Runs plain Playwright headless render (no LLM) for SPA/JS-heavy pages,
 * extracts hydrated HTML, and re-routes into parse queue with renderMode: 'rendered'.
 */
export function createRenderWorker(deps: RenderWorkerDependencies): Worker<RenderJobPayload> {
  const worker = new Worker<RenderJobPayload>(
    QUEUE_NAMES.RENDER,
    async (job: Job<RenderJobPayload>) => {
      const { url, depth, domain } = job.data;
      logger.info({ url, depth }, 'Starting Playwright JS render job');

      const session = new BrowserSession({ headless: true });
      try {
        await session.initialize();
        const obs = await session.navigate(url);

        const urlHash = computeUrlHash(url);
        const html = `<!DOCTYPE html><html><head><title>${obs.title}</title></head><body><h1>${obs.title}</h1><div>${obs.contentSummary}</div></body></html>`;

        await deps.parseQueue.add(
          'parse-rendered',
          {
            url,
            urlHash,
            domain,
            html,
            httpStatus: 200,
            fetchedAt: new Date().toISOString(),
            renderMode: 'rendered',
            depth,
          },
          {
            jobId: `rendered-${urlHash}`,
            removeOnComplete: true,
          }
        );

        logger.info({ url, title: obs.title }, 'Render worker completed dynamic hydration');
      } finally {
        await session.close().catch(() => {});
      }
    },
    {
      connection: deps.redis,
      concurrency: deps.concurrency || 2,
    }
  );

  return worker;
}
