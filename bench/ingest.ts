import { connectMongo, closeMongo, DocumentRepository } from '@sift/db';
import { SyntheticCorpusGenerator } from '../packages/db/src/importers/synthetic-corpus.js';
import { createLogger } from '@sift/core';
import fs from 'node:fs';
import path from 'node:path';

const logger = createLogger('bench-ingest');

export interface IngestBenchResult {
  targetDocs: number;
  batchSize: number;
  totalDurationMs: number;
  docsPerSecond: number;
  avgBatchLatencyMs: number;
  memoryRssMb: number;
  heapUsedMb: number;
  timestamp: string;
}

export async function runIngestBenchmark(
  targetDocs = 100000,
  batchSize = 1000
): Promise<IngestBenchResult> {
  logger.info({ targetDocs, batchSize }, 'Starting Ingestion Throughput Benchmark...');

  const { db } = await connectMongo();
  const repo = new DocumentRepository(db);
  const generator = new SyntheticCorpusGenerator();

  const batchLatencies: number[] = [];
  const startTime = Date.now();
  let ingested = 0;

  const stats = await generator.generateCorpus(
    targetDocs,
    async (batch) => {
      const bStart = Date.now();
      await repo.bulkUpsert(batch);
      const bDuration = Date.now() - bStart;
      batchLatencies.push(bDuration);
      ingested += batch.length;

      if (ingested % 25000 === 0 || ingested === targetDocs) {
        logger.info(
          {
            progress: `${ingested}/${targetDocs}`,
            pct: `${Math.round((ingested / targetDocs) * 100)}%`,
            lastBatchMs: bDuration,
          },
          'Ingestion benchmark progress'
        );
      }
    },
    batchSize
  );

  const totalDurationMs = Date.now() - startTime;
  const avgBatchLatencyMs =
    batchLatencies.length > 0
      ? Math.round(batchLatencies.reduce((a, b) => a + b, 0) / batchLatencies.length)
      : 0;

  const mem = process.memoryUsage();
  const memoryRssMb = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);

  const result: IngestBenchResult = {
    targetDocs,
    batchSize,
    totalDurationMs,
    docsPerSecond: stats.docsPerSecond,
    avgBatchLatencyMs,
    memoryRssMb,
    heapUsedMb,
    timestamp: new Date().toISOString(),
  };

  logger.info(
    {
      targetDocs,
      docsPerSec: result.docsPerSecond,
      durationSec: Math.round(totalDurationMs / 1000),
      avgBatchLatencyMs,
      memoryRssMb,
    },
    'Ingestion Benchmark Complete'
  );

  // Save report to bench/results
  const resultsDir = path.resolve(process.cwd(), 'bench/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const jsonPath = path.join(resultsDir, `ingest-${targetDocs}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
  logger.info({ jsonPath }, 'Saved raw benchmark result');

  await closeMongo();
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = parseInt(process.argv[2] || '100000', 10);
  const batch = parseInt(process.argv[3] || '1000', 10);

  runIngestBenchmark(target, batch)
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Ingest benchmark encountered fatal error');
      process.exit(1);
    });
}
