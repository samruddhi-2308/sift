import readline from 'node:readline';
import crypto from 'node:crypto';
import { getDomain } from 'tldts';
import type { DocumentSchema } from '@sift/core';
import type { StreamImporter, ImportStats } from './types.js';

function computeUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function computeSimHashQuick(text: string): string {
  const hash = crypto.createHash('sha256').update(text.slice(0, 2000)).digest('hex');
  return hash.slice(0, 16);
}

export class CommonCrawlWETImporter implements StreamImporter {
  name = 'CommonCrawlWETImporter';
  sourceType = 'commoncrawl' as const;

  /**
   * Streams and parses Common Crawl WET records one-by-one with constant memory
   */
  async importFromStream(
    stream: NodeJS.ReadableStream,
    batchHandler: (docs: DocumentSchema[]) => Promise<void>,
    options: { maxDocs?: number; batchSize?: number } = {}
  ): Promise<ImportStats> {
    const startTime = Date.now();
    const maxDocs = options.maxDocs || Infinity;
    const batchSize = options.batchSize || 1000;

    let totalProcessed = 0;
    let totalIngested = 0;
    let skippedCount = 0;
    let currentBatch: DocumentSchema[] = [];

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let currentUri = '';
    let currentBody: string[] = [];
    let isReadingBody = false;

    for await (const line of rl) {
      if (totalIngested >= maxDocs) break;

      if (line.startsWith('WARC/1.0')) {
        // Flush previously accumulated record
        if (currentUri && currentBody.length > 0) {
          totalProcessed++;
          const fullText = currentBody.join('\n').trim();
          if (fullText.length >= 100) {
            const domain = getDomain(currentUri) || 'commoncrawl.org';
            const urlHash = computeUrlHash(currentUri);
            const contentHash = computeSimHashQuick(fullText);

            // First non-empty line as title heuristic
            const firstLine =
              currentBody.find((l) => l.trim().length > 3)?.trim() || 'Extracted Document';
            const title = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;

            const doc: DocumentSchema = {
              urlHash,
              url: currentUri,
              canonicalUrl: currentUri,
              domain,
              title,
              text: fullText.slice(0, 50000),
              textLength: Math.min(fullText.length, 50000),
              headings: [title],
              lang: 'en',
              contentHash,
              outlinks: 0,
              fetchedAt: new Date(),
              httpStatus: 200,
              renderMode: 'static',
              source: 'commoncrawl',
              embedding: null,
              schemaVersion: 1,
            };

            currentBatch.push(doc);
            totalIngested++;

            if (currentBatch.length >= batchSize) {
              await batchHandler(currentBatch);
              currentBatch = [];
            }
          } else {
            skippedCount++;
          }
        }

        currentUri = '';
        currentBody = [];
        isReadingBody = false;
        continue;
      }

      if (line.startsWith('WARC-Target-URI:')) {
        currentUri = line.slice('WARC-Target-URI:'.length).trim();
        continue;
      }

      if (line.startsWith('Content-Length:')) {
        isReadingBody = false;
        continue;
      }

      if (!isReadingBody && line.trim() === '' && currentUri) {
        isReadingBody = true;
        continue;
      }

      if (isReadingBody && currentUri) {
        currentBody.push(line);
      }
    }

    // Flush last document
    if (currentUri && currentBody.length > 0 && totalIngested < maxDocs) {
      const fullText = currentBody.join('\n').trim();
      if (fullText.length >= 100) {
        const domain = getDomain(currentUri) || 'commoncrawl.org';
        const doc: DocumentSchema = {
          urlHash: computeUrlHash(currentUri),
          url: currentUri,
          canonicalUrl: currentUri,
          domain,
          title: currentBody[0]?.slice(0, 100) || 'Extracted Document',
          text: fullText.slice(0, 50000),
          textLength: Math.min(fullText.length, 50000),
          headings: [currentBody[0]?.slice(0, 100) || 'Extracted Document'],
          lang: 'en',
          contentHash: computeSimHashQuick(fullText),
          outlinks: 0,
          fetchedAt: new Date(),
          httpStatus: 200,
          renderMode: 'static',
          source: 'commoncrawl',
          embedding: null,
          schemaVersion: 1,
        };
        currentBatch.push(doc);
        totalIngested++;
      }
    }

    if (currentBatch.length > 0) {
      await batchHandler(currentBatch);
    }

    const durationMs = Date.now() - startTime;
    return {
      totalProcessed,
      totalIngested,
      skippedCount,
      durationMs,
      docsPerSecond:
        durationMs > 0 ? Math.round((totalIngested / durationMs) * 1000) : totalIngested,
    };
  }
}
