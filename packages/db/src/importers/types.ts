import type { DocumentSchema } from '@sift/core';

export interface ImportStats {
  totalProcessed: number;
  totalIngested: number;
  skippedCount: number;
  durationMs: number;
  docsPerSecond: number;
}

export interface StreamImporter {
  name: string;
  sourceType: 'wikipedia' | 'commoncrawl' | 'other';
  importFromStream(
    stream: NodeJS.ReadableStream,
    batchHandler: (docs: DocumentSchema[]) => Promise<void>,
    options?: { maxDocs?: number; batchSize?: number }
  ): Promise<ImportStats>;
}
