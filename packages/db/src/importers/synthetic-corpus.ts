import crypto from 'node:crypto';
import type { DocumentSchema } from '@sift/core';
import type { ImportStats } from './types.js';

const DOMAINS = [
  'arxiv.org',
  'github.blog',
  'netflixtechblog.com',
  'eng.uber.com',
  'engineering.fb.com',
  'aws.amazon.com/blogs',
  'blog.cloudflare.com',
  'kernel.org',
  'redis.io/blog',
  'mongodb.com/developer',
  'qdrant.tech/articles',
  'fastify.dev/docs',
];

const TOPICS = [
  {
    topic: 'Distributed Systems',
    keywords: [
      'consensus',
      'Raft',
      'Paxos',
      'partitioning',
      'sharding',
      'eventual consistency',
      'vector clocks',
    ],
  },
  {
    topic: 'Vector Search & Information Retrieval',
    keywords: [
      'HNSW',
      'embeddings',
      'cosine similarity',
      'reciprocal rank fusion',
      'BM25',
      'cross-encoder',
      'nDCG',
    ],
  },
  {
    topic: 'Database Internals',
    keywords: [
      'WiredTiger',
      'LSM-tree',
      'B-tree',
      'write-ahead log',
      'compound indexes',
      'MVCC',
      'ACID transactions',
    ],
  },
  {
    topic: 'Web Crawling & Politeness',
    keywords: [
      'robots.txt',
      'token bucket',
      'Bloom filter',
      'SimHash',
      'undici',
      'spider trap',
      'Dead Letter Queue',
    ],
  },
  {
    topic: 'LLM Browser Agents',
    keywords: [
      'Playwright',
      'accessibility tree',
      'function calling',
      'observe decide act',
      'JSON schema',
      'structured extraction',
    ],
  },
  {
    topic: 'Network Engineering & Security',
    keywords: [
      'SSRF protection',
      'DNS rebinding',
      'TLS 1.3',
      'HTTP/2 multiplexing',
      'TCP window scaling',
      'connection pooling',
    ],
  },
];

function computeUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function computeSimHashQuick(text: string): string {
  return crypto.createHash('sha256').update(text.slice(0, 1000)).digest('hex').slice(0, 16);
}

export class SyntheticCorpusGenerator {
  /**
   * Generates N realistic technical documents in streaming batches
   */
  async generateCorpus(
    targetCount: number,
    batchHandler: (docs: DocumentSchema[]) => Promise<void>,
    batchSize = 1000
  ): Promise<ImportStats> {
    const startTime = Date.now();
    let totalIngested = 0;
    let currentBatch: DocumentSchema[] = [];

    for (let i = 1; i <= targetCount; i++) {
      const topicObj = TOPICS[i % TOPICS.length]!;
      const domain = DOMAINS[i % DOMAINS.length]!;
      const keyword = topicObj.keywords[i % topicObj.keywords.length]!;

      const title = `${topicObj.topic}: Comprehensive Architecture and Analysis of ${keyword} (Part ${Math.floor(i / 10) + 1})`;
      const url = `https://${domain}/articles/${topicObj.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-doc-${i}`;

      const text = `
        This technical document explores ${keyword} within the domain of ${topicObj.topic}.
        In modern high-performance engineering, systems must balance scalability, low latency, and reliability.
        When configuring compound indexes and optimizing storage engines, query plans must be scrutinized with executionStats to eliminate full collection scans.
        Furthermore, hybrid retrieval systems combine lexical keyword scoring (such as BM25 or weighted inverted indexes) with dense vector representations indexing embeddings via HNSW graphs.
        By fusing results through Reciprocal Rank Fusion (k=60), ranking quality improves significantly across ambiguous and natural language queries.
        This document represents indexed corpus node #${i} serving high-throughput search latency benchmarks under 5 milliseconds p95.
      `
        .trim()
        .replace(/\s+/g, ' ');

      const doc: DocumentSchema = {
        urlHash: computeUrlHash(url),
        url,
        canonicalUrl: url,
        domain,
        title,
        text,
        textLength: text.length,
        headings: [
          title,
          `Deep Dive into ${keyword}`,
          'Architectural Tradeoffs',
          'Benchmarking and Evaluation',
        ],
        lang: 'en',
        contentHash: computeSimHashQuick(text),
        outlinks: (i % 7) + 1,
        fetchedAt: new Date(Date.now() - (i % 30) * 86400000),
        httpStatus: 200,
        renderMode: 'static',
        source: 'other',
        embedding: null,
        schemaVersion: 1,
      };

      currentBatch.push(doc);
      totalIngested++;

      if (currentBatch.length >= batchSize) {
        await batchHandler(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      await batchHandler(currentBatch);
    }

    const durationMs = Date.now() - startTime;
    return {
      totalProcessed: targetCount,
      totalIngested,
      skippedCount: 0,
      durationMs,
      docsPerSecond:
        durationMs > 0 ? Math.round((totalIngested / durationMs) * 1000) : totalIngested,
    };
  }
}
