import { Command } from 'commander';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { connectMongo, closeMongo, DocumentRepository } from '../index.js';
import { WikipediaStreamImporter } from './wikipedia-importer.js';
import { CommonCrawlWETImporter } from './commoncrawl-importer.js';
import { SyntheticCorpusGenerator } from './synthetic-corpus.js';
import { createLogger } from '@sift/core';

const logger = createLogger('importer-cli');
const program = new Command();

program
  .name('sift-importer')
  .description('Streaming bulk data importers for Wikipedia, Common Crawl, and Synthetic Corpora')
  .version('1.0.0');

// Command: Wikipedia Dump Importer
program
  .command('wiki')
  .description('Stream import a Wikipedia dump file (.jsonl, .jsonl.gz, .xml)')
  .argument('<filepath>', 'Path to Wikipedia dump file')
  .option('-m, --max <number>', 'Maximum documents to ingest', '100000')
  .action(async (filepath: string, options: { max: string }) => {
    const { db } = await connectMongo();
    const repo = new DocumentRepository(db);
    const importer = new WikipediaStreamImporter();
    const maxDocs = parseInt(options.max, 10);

    logger.info({ filepath, maxDocs }, 'Starting Wikipedia streaming ingestion...');

    let fileStream: NodeJS.ReadableStream = fs.createReadStream(filepath);
    if (filepath.endsWith('.gz')) {
      fileStream = fileStream.pipe(zlib.createGunzip());
    }

    const stats = await importer.importFromStream(
      fileStream,
      async (batch) => {
        await repo.bulkUpsert(batch);
      },
      { maxDocs, batchSize: 1000 }
    );

    logger.info(stats, 'Wikipedia import finished');
    await closeMongo();
  });

// Command: Common Crawl WET Importer
program
  .command('wet')
  .description('Stream import a Common Crawl WET archive file (.wet, .wet.gz)')
  .argument('<filepath>', 'Path to WET file')
  .option('-m, --max <number>', 'Maximum documents to ingest', '100000')
  .action(async (filepath: string, options: { max: string }) => {
    const { db } = await connectMongo();
    const repo = new DocumentRepository(db);
    const importer = new CommonCrawlWETImporter();
    const maxDocs = parseInt(options.max, 10);

    logger.info({ filepath, maxDocs }, 'Starting Common Crawl WET streaming ingestion...');

    let fileStream: NodeJS.ReadableStream = fs.createReadStream(filepath);
    if (filepath.endsWith('.gz')) {
      fileStream = fileStream.pipe(zlib.createGunzip());
    }

    const stats = await importer.importFromStream(
      fileStream,
      async (batch) => {
        await repo.bulkUpsert(batch);
      },
      { maxDocs, batchSize: 1000 }
    );

    logger.info(stats, 'Common Crawl import finished');
    await closeMongo();
  });

// Command: Synthetic Corpus Generator
program
  .command('synthetic')
  .description(
    'Generate synthetic technical documents directly into MongoDB for scaling benchmarks'
  )
  .argument('[count]', 'Number of documents to generate', '100000')
  .option('-b, --batch <number>', 'Batch size for bulkUpsert', '1000')
  .action(async (countStr: string, options: { batch: string }) => {
    const count = parseInt(countStr, 10);
    const batchSize = parseInt(options.batch, 10);
    const { db } = await connectMongo();
    const repo = new DocumentRepository(db);
    const generator = new SyntheticCorpusGenerator();

    logger.info({ targetCount: count, batchSize }, 'Starting synthetic corpus generation...');

    let lastLogged = 0;
    const stats = await generator.generateCorpus(
      count,
      async (batch) => {
        await repo.bulkUpsert(batch);
        lastLogged += batch.length;
        if (lastLogged % 25000 === 0 || lastLogged >= count) {
          logger.info({ ingested: lastLogged, total: count }, 'Ingestion progress update');
        }
      },
      batchSize
    );

    logger.info(
      {
        totalIngested: stats.totalIngested,
        durationSeconds: Math.round(stats.durationMs / 1000),
        docsPerSec: stats.docsPerSecond,
      },
      'Synthetic corpus generation completed'
    );

    await closeMongo();
  });

program.parse(process.argv);
