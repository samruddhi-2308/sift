/**
 * Tokenizes search query into unique significant keywords for snippet scoring and highlighting
 */
export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((term) => term.length >= 2);
}

/**
 * Escapes special regex characters in a query token
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlights matched query terms within text using HTML <mark> tags
 */
export function highlightTerms(text: string, terms: string[]): string {
  if (!text || terms.length === 0) return text;

  // Build regex matching any of the terms as whole words or prefixes
  const pattern = terms.map(escapeRegex).join('|');
  if (!pattern) return text;

  const regex = new RegExp(`\\b(${pattern})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

/**
 * Extracts the best contextual snippet containing the highest concentration of query terms
 */
export function generateSnippet(
  text: string,
  query: string,
  options: { maxChars?: number; bestPassage?: string } = {}
): { snippet: string; matchedTerms: string[] } {
  const maxChars = options.maxChars || 200;
  const terms = extractQueryTerms(query);

  if (!text && !options.bestPassage) {
    return { snippet: '', matchedTerms: [] };
  }

  // If a best matching chunk passage is already identified from vector search, prioritize it
  const sourceText = options.bestPassage || text;
  const clean = sourceText.replace(/\s+/g, ' ').trim();

  if (clean.length <= maxChars) {
    const matched = terms.filter((t) => new RegExp(`\\b${escapeRegex(t)}`, 'i').test(clean));
    return {
      snippet: highlightTerms(clean, terms),
      matchedTerms: matched,
    };
  }

  // Split text into sliding candidate sentences or sentence fragments
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    let score = 0;
    const matchedCount = new Set<string>();

    for (const term of terms) {
      const regex = new RegExp(`\\b${escapeRegex(term)}`, 'gi');
      const matches = s.match(regex);
      if (matches) {
        matchedCount.add(term);
        score += matches.length * 2;
      }
    }

    // High bonus for covering multiple distinct terms
    score += matchedCount.size * 5;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  // Construct snippet window starting around bestIndex
  let snippetText = sentences[bestIndex] || clean.slice(0, maxChars);
  let prependEllipsis = bestIndex > 0;
  let appendEllipsis = bestIndex < sentences.length - 1;

  if (snippetText.length < maxChars && bestIndex + 1 < sentences.length) {
    snippetText += ' ' + sentences[bestIndex + 1];
  }

  if (snippetText.length > maxChars) {
    // Truncate at last word boundary before maxChars
    const truncated = snippetText.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    snippetText = lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated;
    appendEllipsis = true;
  }

  const finalSnippet = `${prependEllipsis ? '... ' : ''}${snippetText.trim()}${appendEllipsis ? ' ...' : ''}`;
  const matched = terms.filter((t) => new RegExp(`\\b${escapeRegex(t)}`, 'i').test(finalSnippet));

  return {
    snippet: highlightTerms(finalSnippet, terms),
    matchedTerms: matched,
  };
}
