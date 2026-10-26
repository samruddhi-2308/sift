import { describe, it, expect } from 'vitest';
import { LocalDeterministicEmbeddingProvider } from '../src/providers/local.js';

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, idx) => sum + val * (b[idx] || 0), 0);
}

describe('Local Deterministic Embedding Provider', () => {
  const provider = new LocalDeterministicEmbeddingProvider();

  it('outputs 384-dimensional vectors', async () => {
    const vectors = await provider.embed(['Search engine indexing architecture']);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
  });

  it('produces unit vectors with L2 norm approximately equal to 1.0', async () => {
    const [vector] = await provider.embed(['Vector similarity search over HNSW']);
    const sumSquares = vector!.reduce((sum, v) => sum + v * v, 0);
    expect(Math.abs(sumSquares - 1.0)).toBeLessThan(0.001);
  });

  it('is completely deterministic for identical inputs', async () => {
    const text = 'MongoDB WiredTiger storage engine compound indexes';
    const [v1] = await provider.embed([text]);
    const [v2] = await provider.embed([text]);
    expect(v1).toEqual(v2);
  });

  it('gives higher cosine similarity for semantically close texts than unrelated texts', async () => {
    const textA = 'Distributed systems consensus protocol Raft leader election';
    const textB = 'Distributed systems consensus algorithms Raft log replication';
    const textC = 'Chocolate strawberry vanilla cheesecake dessert recipe baking';

    const [vecA, vecB, vecC] = await provider.embed([textA, textB, textC]);

    const simAB = dotProduct(vecA!, vecB!);
    const simAC = dotProduct(vecA!, vecC!);

    expect(simAB).toBeGreaterThan(simAC);
  });

  it('supports embedQuery method', async () => {
    const queryVector = await provider.embedQuery('What is HNSW indexing?');
    expect(queryVector).toHaveLength(384);
  });
});
