import { describe, it, expect } from 'vitest';
import { chunkDocument, estimateTokens } from '../src/chunker.js';

describe('Document Chunker', () => {
  it('estimates token count using character heuristic', () => {
    expect(estimateTokens('Hello world')).toBe(3); // 11 / 4 rounded up
  });

  it('keeps short text within a single chunk with title prepended', () => {
    const title = 'Fastify High-Performance Framework';
    const text = 'Fastify is a fast and low overhead web framework for Node.js.';
    const chunks = chunkDocument(title, text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.text).toBe(text);
    expect(chunks[0]?.contentToEmbed).toBe(`Title: ${title}\n\n${text}`);
  });

  it('splits long text into multiple overlapping chunks', () => {
    const title = 'Distributed Systems Guide';
    const paragraphs = [
      'In distributed computing, consensus protocols ensure nodes agree on system state.',
      'Raft is designed to be understandable and decomposes consensus into leader election and log replication.',
      'Paxos remains the formal baseline for fault-tolerant state machine replication in distributed systems.',
      'Vector clocks provide causal ordering of events in distributed environments without physical clock sync.',
    ];
    // Create a long text exceeding single chunk limit
    const longText = paragraphs.map((p) => p.repeat(15)).join('\n\n');

    const chunks = chunkDocument(title, longText, {
      targetTokens: 100, // Small limit for testing
      overlapTokens: 20,
      maxChunksPerDoc: 10,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.contentToEmbed).toContain(`Title: ${title}\n\n`);
      expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('enforces maxChunksPerDoc limit for cost control', () => {
    const title = 'Lengthy Architecture Paper';
    const hugeText = 'Paragraph of text. '.repeat(1000);

    const chunks = chunkDocument(title, hugeText, {
      targetTokens: 50,
      maxChunksPerDoc: 3,
    });

    expect(chunks).toHaveLength(3);
  });
});
