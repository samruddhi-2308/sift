import {
  Worker,
  type Job,
  type Queue,
  type Redis,
  QUEUE_NAMES,
  type ParseJobPayload,
  type IngestJobPayload,
  type RenderJobPayload,
} from '@sift/queue';
import { HtmlParser } from '../parser/html-parser.js';
import type { CrawlFrontier } from '../frontier/frontier.js';
import { createLogger, type DocumentSchema } from '@sift/core';
import { computeUrlHash } from '../dedupe/url-normalizer.js';

const logger = createLogger('parse-worker');

export interface ParseWorkerDependencies {
  redis: Redis;
  frontier: CrawlFrontier;
  ingestQueue: Queue<IngestJobPayload>;
  renderQueue?: Queue<RenderJobPayload>;
  concurrency?: number;
}

export function createParseWorker(deps: ParseWorkerDependencies): Worker<ParseJobPayload> {
  const parser = new HtmlParser();

  const worker = new Worker<ParseJobPayload>(
    QUEUE_NAMES.PARSE,
    async (job: Job<ParseJobPayload>) => {
      const { url, html, httpStatus, fetchedAt, depth, domain, renderMode } = job.data;
      logger.info({ url, depth }, 'Starting parse job');

      const parsed = parser.parse(html, url);
      const urlHash = computeUrlHash(url);

      // Re-route SPA pages to Playwright render worker if static content was inadequate
      if (parsed.needsJsRendering && renderMode !== 'rendered' && deps.renderQueue) {
        logger.info({ url }, 'Page requires JS rendering; re-routing to render queue');
        await deps.renderQueue.add(
          'render-spa',
          { url, depth, domain },
          { jobId: `render-${urlHash}`, removeOnComplete: true }
        );
        return;
      }

      // 1. Prepare structured Document for ingestion
      const document: DocumentSchema = {
        urlHash,
        url,
        canonicalUrl: parsed.canonicalUrl,
        domain,
        title: parsed.title,
        text: parsed.text,
        textLength: parsed.textLength,
        headings: parsed.headings,
        lang: parsed.lang,
        contentHash: parsed.contentHash,
        outlinks: parsed.outlinks.length,
        fetchedAt: new Date(fetchedAt),
        httpStatus,
        renderMode: parsed.renderMode,
        source: 'crawl',
        embedding: null,
        schemaVersion: 1,
      };

      // 2. Enqueue document into ingest queue
      await deps.ingestQueue.add(
        'ingest-document',
        { document },
        {
          jobId: urlHash,
          removeOnComplete: true,
        }
      );

      // 3. Discover and feed new outlinks back to frontier (if under max depth)
      if (depth < 8 && parsed.outlinks.length > 0) {
        const result = await deps.frontier.enqueue(parsed.outlinks, {
          depth: depth + 1,
          referrer: url,
        });

        logger.debug(
          { url, discovered: parsed.outlinks.length, enqueued: result.enqueued },
          'Processed outlinks from parsed page'
        );
      }

      logger.info(
        {
          url,
          title: parsed.title,
          textLength: parsed.textLength,
          outlinks: parsed.outlinks.length,
        },
        'Parse completed successfully'
      );
    },
    {
      connection: deps.redis,
      concurrency: deps.concurrency || 5,
    }
  );

  return worker;
}
