import type { TextChunk } from './types.js';

export interface ChunkerOptions {
  targetTokens?: number; // Default 400 tokens (~1600 characters)
  overlapTokens?: number; // Default 50 tokens (~200 characters)
  maxChunksPerDoc?: number; // Default 20 (cost control)
}

/**
 * Estimates token count for English text (~4 characters per token heuristic)
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Splits document text on paragraph and sentence boundaries into overlapping chunks,
 * prepending the document title to preserve global context for dense vector similarity.
 */
export function chunkDocument(
  title: string,
  text: string,
  options: ChunkerOptions = {}
): TextChunk[] {
  const targetChars = (options.targetTokens || 400) * 4;
  const overlapChars = (options.overlapTokens || 50) * 4;
  const maxChunks = options.maxChunksPerDoc || 20;

  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (!cleanText) {
    return [];
  }

  // Short documents fit in a single chunk
  if (cleanText.length <= targetChars) {
    return [
      {
        chunkIndex: 0,
        text: cleanText,
        contentToEmbed: `Title: ${title}\n\n${cleanText}`,
        tokenEstimate: estimateTokens(cleanText),
      },
    ];
  }

  // Split text by paragraph boundaries, falling back to sentence boundaries
  const rawSegments = cleanText
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      if (paragraph.length > targetChars) {
        // Split long paragraphs on sentence boundaries
        return paragraph.split(/(?<=[.!?])\s+/);
      }
      return [paragraph];
    })
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let currentAccumulator: string[] = [];
  let currentLength = 0;
  let chunkIndex = 0;

  for (const segment of rawSegments) {
    if (chunks.length >= maxChunks) break;

    // If a single segment is extraordinarily long, slice it into hard chunks
    if (segment.length > targetChars) {
      if (currentAccumulator.length > 0) {
        const chunkText = currentAccumulator.join(' ').trim();
        chunks.push({
          chunkIndex: chunkIndex++,
          text: chunkText,
          contentToEmbed: `Title: ${title}\n\n${chunkText}`,
          tokenEstimate: estimateTokens(chunkText),
        });
        currentAccumulator = [];
        currentLength = 0;
      }

      for (let i = 0; i < segment.length; i += targetChars - overlapChars) {
        if (chunks.length >= maxChunks) break;
        const slice = segment.slice(i, i + targetChars).trim();
        if (slice) {
          chunks.push({
            chunkIndex: chunkIndex++,
            text: slice,
            contentToEmbed: `Title: ${title}\n\n${slice}`,
            tokenEstimate: estimateTokens(slice),
          });
        }
      }
      continue;
    }

    if (currentLength + segment.length > targetChars && currentAccumulator.length > 0) {
      const chunkText = currentAccumulator.join(' ').trim();
      chunks.push({
        chunkIndex: chunkIndex++,
        text: chunkText,
        contentToEmbed: `Title: ${title}\n\n${chunkText}`,
        tokenEstimate: estimateTokens(chunkText),
      });

      // Retain trailing sentences/segments to maintain overlapping context
      const overlapAccumulator: string[] = [];
      let accumulatedOverlap = 0;
      for (let j = currentAccumulator.length - 1; j >= 0; j--) {
        const seg = currentAccumulator[j]!;
        if (accumulatedOverlap + seg.length <= overlapChars) {
          overlapAccumulator.unshift(seg);
          accumulatedOverlap += seg.length;
        } else {
          break;
        }
      }

      currentAccumulator = overlapAccumulator;
      currentLength = accumulatedOverlap;
    }

    currentAccumulator.push(segment);
    currentLength += segment.length;
  }

  // Push final remaining chunk
  if (currentAccumulator.length > 0 && chunks.length < maxChunks) {
    const chunkText = currentAccumulator.join(' ').trim();
    if (chunkText) {
      chunks.push({
        chunkIndex: chunkIndex++,
        text: chunkText,
        contentToEmbed: `Title: ${title}\n\n${chunkText}`,
        tokenEstimate: estimateTokens(chunkText),
      });
    }
  }

  return chunks;
}
