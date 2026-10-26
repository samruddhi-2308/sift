import { describe, it, expect } from 'vitest';
import robotsParser from 'robots-parser';

describe('Robots.txt Rules & Crawl-delay Evaluation', () => {
  const robotsTxt = `
User-agent: *
Disallow: /admin/
Disallow: /private/
Allow: /admin/public/
Crawl-delay: 2

User-agent: SiftBot
Disallow: /internal/
Disallow: /secret-area/
Crawl-delay: 3
`;

  const parser = robotsParser('https://example.com/robots.txt', robotsTxt);

  it('honours specific Disallow directives for SiftBot', () => {
    expect(parser.isAllowed('https://example.com/internal/data', 'SiftBot')).toBe(false);
    expect(parser.isAllowed('https://example.com/secret-area/page', 'SiftBot')).toBe(false);
  });

  it('honours wildcard rules for general crawlers', () => {
    expect(parser.isAllowed('https://example.com/admin/dashboard', 'Googlebot')).toBe(false);
    expect(parser.isAllowed('https://example.com/admin/public/info', 'Googlebot')).toBe(true);
  });

  it('allows public routes', () => {
    expect(parser.isAllowed('https://example.com/blog', 'SiftBot')).toBe(true);
    expect(parser.isAllowed('https://example.com/about', 'SiftBot')).toBe(true);
  });

  it('extracts Crawl-delay for SiftBot', () => {
    expect(parser.getCrawlDelay('SiftBot')).toBe(3);
    expect(parser.getCrawlDelay('OtherBot')).toBe(2);
  });
});
