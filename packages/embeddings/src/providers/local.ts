import crypto from 'node:crypto';
import type { EmbeddingProvider } from '../types.js';

/**
 * Normalizes a vector to unit length (L2 norm = 1.0) for accurate cosine similarity
 */
function normalizeL2(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) {
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq) || 1.0;
  return vector.map((v) => v / norm);
}

/**
 * Deterministic local embedding provider generating 384-dimensional unit vectors.
 * Enables zero-cost local development, unit testing, and offline benchmarking.
 */
export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-deterministic';
  readonly model = 'local-bge-384';
  readonly dimension = 384;
  readonly version = 1;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.generateVector(t));
  }

  async embedQuery(query: string): Promise<number[]> {
    return this.generateVector(query);
  }

  private generateVector(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const hash = crypto.createHash('sha256').update(token).digest();

      for (let d = 0; d < this.dimension; d++) {
        const byteIndex = d % 32;
        const bit = (hash[byteIndex]! >> (d % 8)) & 1;
        const weight = 1 / Math.sqrt(i + 1);
        vector[d] += (bit === 1 ? 1 : -1) * weight;
      }
    }

    return normalizeL2(vector);
  }
}
