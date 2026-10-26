import readline from 'node:readline';
import crypto from 'node:crypto';
import type { DocumentSchema } from '@sift/core';
import type { StreamImporter, ImportStats } from './types.js';

function computeUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function computeSimHashQuick(text: string): string {
  const hash = crypto.createHash('sha256').update(text.slice(0, 2000)).digest('hex');
  return hash.slice(0, 16);
}

export class WikipediaStreamImporter implements StreamImporter {
  name = 'WikipediaStreamImporter';
  sourceType = 'wikipedia' as const;

  /**
   * Streams a Wikipedia JSONL or XML export line-by-line with constant memory usage
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

    for await (const line of rl) {
      if (totalIngested >= maxDocs) break;
      const trimmed = line.trim();
      if (!trimmed) continue;

      totalProcessed++;

      try {
        let title = '';
        let text = '';
        let url = '';

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          // JSONL format: {"title": "...", "text": "...", "url": "..."}
          const parsed = JSON.parse(trimmed);
          title = parsed.title || 'Untitled Article';
          text = parsed.text || '';
          url =
            parsed.url ||
            `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
        } else if (trimmed.includes('<title>') && trimmed.includes('</title>')) {
          // XML fragment match
          const match = trimmed.match(/<title>(.*?)<\/title>/);
          if (match && match[1]) {
            title = match[1];
            text = trimmed
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
          }
        }

        if (!title || text.length < 50) {
          skippedCount++;
          continue;
        }

        const urlHash = computeUrlHash(url);
        const contentHash = computeSimHashQuick(text);

        // Extract basic section headings from text if any
        const headings: string[] = [title];
        const headingMatches = text.match(/(?:^|\n)==\s*(.*?)\s*==/g);
        if (headingMatches) {
          for (const h of headingMatches.slice(0, 10)) {
            const cleanH = h.replace(/=/g, '').trim();
            if (cleanH) headings.push(cleanH);
          }
        }

        const doc: DocumentSchema = {
          urlHash,
          url,
          canonicalUrl: url,
          domain: 'wikipedia.org',
          title,
          text: text.slice(0, 50000), // Cap text length per PRD guidelines
          textLength: Math.min(text.length, 50000),
          headings,
          lang: 'en',
          contentHash,
          outlinks: 0,
          fetchedAt: new Date(),
          httpStatus: 200,
          renderMode: 'static',
          source: 'wikipedia',
          embedding: null,
          schemaVersion: 1,
        };

        currentBatch.push(doc);
        totalIngested++;

        if (currentBatch.length >= batchSize) {
          await batchHandler(currentBatch);
          currentBatch = [];
        }
      } catch {
        skippedCount++;
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
