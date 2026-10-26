import { describe, it, expect } from 'vitest';
import { generatePointId } from '../src/embed-worker.js';

describe('Point ID Generation', () => {
  it('generates valid UUID v4 compliant string from urlHash and chunkIndex', () => {
    const id = generatePointId('a1b2c3d4e5f60718', 0);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates different IDs for different chunk indices on the same document', () => {
    const id0 = generatePointId('a1b2c3d4e5f60718', 0);
    const id1 = generatePointId('a1b2c3d4e5f60718', 1);
    expect(id0).not.toEqual(id1);
  });

  it('is deterministic across invocations', () => {
    const idA = generatePointId('test-hash-1234', 2);
    const idB = generatePointId('test-hash-1234', 2);
    expect(idA).toBe(idB);
  });
});
