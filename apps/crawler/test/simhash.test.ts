import { describe, it, expect } from 'vitest';
import { computeSimHash, hammingDistance, isNearDuplicate } from '../src/dedupe/simhash.js';

describe('SimHash Near-Duplicate Detection', () => {
  it('generates 16-character hex fingerprint', () => {
    const hash = computeSimHash('The quick brown fox jumps over the lazy dog');
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
  });

  it('produces identical SimHash for identical content regardless of extra whitespace', () => {
    const textA = 'Distributed polite web crawler for massive search engine ingestion.';
    const textB =
      '  Distributed   polite   web   crawler   for massive search engine ingestion.  \n';
    expect(computeSimHash(textA)).toBe(computeSimHash(textB));
  });

  it('detects near-duplicates with minor modifications (Hamming distance <= 3)', () => {
    const original = `
      Sift is a self-hosted modern AI search engine engineered in TypeScript and Node.js.
      It features a polite web crawler with robots.txt compliance, token bucket rate limiting,
      and RedisBloom deduplication. It ingests documents into MongoDB in bulk batches with compound
      indexes designed for sub-5 millisecond p95 latency. Text chunks are embedded and indexed
      in Qdrant vector database, fused using Reciprocal Rank Fusion, and optionally re-ranked
      with a cross-encoder model. The system also includes an autonomous Playwright browser agent.
    `;
    const minorEdit = `
      Sift is a self-hosted modern AI search engine engineered in TypeScript and Node.js.
      It features a polite web crawler with robots.txt compliance, token bucket rate limiting,
      and RedisBloom deduplication. It ingests documents into MongoDB in bulk batches with compound
      indexes designed for sub-5 ms p95 latency. Text chunks are embedded and indexed
      in Qdrant vector database, fused using Reciprocal Rank Fusion, and optionally re-ranked
      with a cross-encoder model. The system also includes an autonomous Playwright browser agent.
    `;

    const hashA = computeSimHash(original);
    const hashB = computeSimHash(minorEdit);
    const distance = hammingDistance(hashA, hashB);

    expect(distance).toBeLessThanOrEqual(3);
    expect(isNearDuplicate(hashA, hashB)).toBe(true);
  });

  it('differentiates completely distinct documents (high Hamming distance)', () => {
    const techDoc =
      'Fastify web framework paired with Redis BullMQ job queues and Qdrant vector database.';
    const cookingRecipe =
      'Chocolate fudge cake recipe with unsalted butter, cocoa powder, and organic brown sugar.';

    const hashA = computeSimHash(techDoc);
    const hashB = computeSimHash(cookingRecipe);
    const distance = hammingDistance(hashA, hashB);

    expect(distance).toBeGreaterThan(10);
    expect(isNearDuplicate(hashA, hashB)).toBe(false);
  });
});
