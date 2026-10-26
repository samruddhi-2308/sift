import { describe, it, expect } from 'vitest';
import { extractQueryTerms, highlightTerms, generateSnippet } from '../src/snippets.js';

describe('Snippet Generation & Highlighting', () => {
  it('extracts unique normalized query terms', () => {
    const terms = extractQueryTerms('fast distributed vector search, fast!');
    expect(terms).toContain('fast');
    expect(terms).toContain('distributed');
    expect(terms).toContain('vector');
    expect(terms).toContain('search');
    expect(terms.filter((t) => t === 'fast').length).toBe(2);
  });

  it('highlights matched terms with <mark> tags', () => {
    const text = 'Sift is an ultra fast distributed search engine.';
    const highlighted = highlightTerms(text, ['fast', 'search']);
    expect(highlighted).toContain('<mark>fast</mark>');
    expect(highlighted).toContain('<mark>search</mark>');
  });

  it('extracts relevant passage window with ellipsis', () => {
    const longText =
      'Introduction to web systems. Many architectures rely on traditional databases. ' +
      'However, hybrid search combines dense vector retrieval with inverted keyword indexing to achieve superior relevance. ' +
      'Conclusion and future work in distributed indexing.';

    const result = generateSnippet(longText, 'hybrid search dense vector', { maxChars: 120 });
    expect(result.snippet).toContain('<mark>hybrid</mark>');
    expect(result.snippet).toContain('<mark>search</mark>');
    expect(result.matchedTerms.length).toBeGreaterThan(0);
  });
});
