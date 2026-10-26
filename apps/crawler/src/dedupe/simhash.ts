import crypto from 'node:crypto';

/**
 * 64-bit token hash function using MD5 / SHA-256 truncated to 64-bit BigInt
 */
function hashToken64(token: string): bigint {
  const hash = crypto.createHash('sha256').update(token).digest();
  return hash.readBigInt64BE(0);
}

/**
 * Computes a 64-bit SimHash fingerprint of text content.
 * Near-duplicate documents produce fingerprints with small Hamming distances (e.g. <= 3).
 */
export function computeSimHash(text: string): string {
  // Normalize whitespace and extract words
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) {
    return '0000000000000000';
  }

  // Generate word bigram shingles to preserve phrase structure
  const tokens: string[] = [];
  for (let i = 0; i < words.length; i++) {
    tokens.push(words[i]!);
    if (i < words.length - 1) {
      tokens.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  // Count token frequencies for feature weighting
  const freqMap = new Map<string, number>();
  for (const token of tokens) {
    freqMap.set(token, (freqMap.get(token) || 0) + 1);
  }

  // 64-element weight vector
  const v = new Int32Array(64);

  for (const [token, weight] of freqMap.entries()) {
    const h = hashToken64(token);
    for (let i = 0; i < 64; i++) {
      const bit = (h >> BigInt(i)) & 1n;
      if (bit === 1n) {
        v[i]! += weight;
      } else {
        v[i]! -= weight;
      }
    }
  }

  // Form 64-bit fingerprint
  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i]! > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }

  // Format as 16-character lowercase hex string
  const unsigned = BigInt.asUintN(64, fingerprint);
  return unsigned.toString(16).padStart(16, '0');
}

/**
 * Computes the Hamming distance (number of differing bits) between two 64-bit SimHash hex strings.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== 16 || hashB.length !== 16) {
    throw new Error('SimHash hex strings must be exactly 16 hex characters (64 bits)');
  }

  const valA = BigInt(`0x${hashA}`);
  const valB = BigInt(`0x${hashB}`);
  let xor = valA ^ valB;

  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }

  return distance;
}

/**
 * Checks if two SimHashes represent near-duplicate documents (default Hamming distance threshold <= 3)
 */
export function isNearDuplicate(hashA: string, hashB: string, threshold = 3): boolean {
  return hammingDistance(hashA, hashB) <= threshold;
}
