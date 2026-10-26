import { config, createLogger } from '@sift/core';
import type { CandidateItem } from './types.js';
import { extractQueryTerms } from './snippets.js';

const logger = createLogger('reranker');

export interface RerankScoreResult {
  index: number;
  score: number;
}

export class SemanticReranker {
  private apiKey?: string;
  private model: string;

  constructor(apiKey = config.GEMINI_API_KEY, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Re-ranks the top candidates (up to topN, default 30) using LLM semantic scoring
   * with automatic fallback to local heuristic cross-scoring
   */
  async rerank(
    query: string,
    candidates: CandidateItem[],
    topN = 30
  ): Promise<CandidateItem[]> {
    if (candidates.length <= 1) return candidates;

    const toRerank = candidates.slice(0, topN);
    const remainder = candidates.slice(topN);

    let scores: Map<number, number> | null = null;

    if (this.apiKey) {
      try {
        scores = await this.scoreWithGemini(query, toRerank);
      } catch (err) {
        logger.warn({ err }, 'Gemini LLM re-ranking failed; falling back to local cross-scorer');
      }
    }

    if (!scores) {
      scores = this.scoreWithLocalFallback(query, toRerank);
    }

    // Assign re-rank scores
    const scoredList = toRerank.map((candidate, idx) => {
      const score = scores!.get(idx) ?? 5.0;
      return {
        ...candidate,
        rerankScore: score,
      };
    });

    // Sort re-ranked candidates descending by rerankScore
    scoredList.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));

    // Append any candidates past topN (retaining their relative RRF order)
    return [...scoredList, ...remainder];
  }

  /**
   * Calls Gemini Flash to score relevance of each candidate from 0.0 to 10.0
   */
  private async scoreWithGemini(
    query: string,
    candidates: CandidateItem[]
  ): Promise<Map<number, number>> {
    const candidateSummaries = candidates.map((c, i) => {
      const snippet = (c.bestChunkText || c.text || '').slice(0, 300).replace(/\s+/g, ' ');
      return `[Candidate ${i}]: Title: ${c.title} | Snippet: ${snippet}`;
    });

    const prompt = `You are an expert search engine relevance judge.
Search Query: "${query}"

Score how relevant each candidate document is to answering the query on a scale of 0.0 to 10.0:
- 10.0: Perfect exact answer or authoritative match
- 7.0-9.0: Highly relevant, answers key aspects
- 4.0-6.0: Partially relevant or related context
- 0.0-3.0: Irrelevant, off-topic, or keyword matching without semantic meaning

Candidates:
${candidateSummaries.join('\n')}

Respond ONLY with valid JSON array of objects: [{"index": number, "score": number}].`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5-second cap

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Gemini re-rank HTTP ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('Gemini response missing text parts');
      }

      const parsed = JSON.parse(rawText) as RerankScoreResult[];
      const scoreMap = new Map<number, number>();

      for (const item of parsed) {
        if (typeof item.index === 'number' && typeof item.score === 'number') {
          scoreMap.set(item.index, Math.min(Math.max(item.score, 0), 10));
        }
      }

      return scoreMap;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Deterministic local cross-scoring fallback when LLM API is unavailable:
   * Analyzes phrase matching, heading presence, query coverage, and density
   */
  private scoreWithLocalFallback(
    query: string,
    candidates: CandidateItem[]
  ): Map<number, number> {
    const terms = extractQueryTerms(query);
    const scoreMap = new Map<number, number>();
    const lowerQuery = query.toLowerCase().trim();

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      let score = 0;

      const title = (c.title || '').toLowerCase();
      const body = (c.bestChunkText || c.text || '').toLowerCase();
      const headings = (c.headings || []).map((h) => h.toLowerCase()).join(' ');

      // 1. Exact full query phrase match
      if (title.includes(lowerQuery)) score += 4.0;
      else if (headings.includes(lowerQuery)) score += 2.5;
      else if (body.includes(lowerQuery)) score += 1.5;

      // 2. Query terms coverage
      let matchedTerms = 0;
      for (const t of terms) {
        if (title.includes(t)) {
          score += 1.2;
          matchedTerms++;
        } else if (headings.includes(t)) {
          score += 0.8;
          matchedTerms++;
        } else if (body.includes(t)) {
          score += 0.4;
          matchedTerms++;
        }
      }

      const coverageRatio = terms.length > 0 ? matchedTerms / terms.length : 0;
      score += coverageRatio * 2.0;

      // 3. Normalized RRF baseline component (preserves retrieval confidence)
      const rrfBaseline = c.rrfScore ? c.rrfScore * 100 : 0;
      score += Math.min(rrfBaseline, 2.0);

      // Clamp between 0.0 and 10.0
      scoreMap.set(i, Number(Math.min(Math.max(score, 0.5), 10.0).toFixed(2)));
    }

    return scoreMap;
  }
}
