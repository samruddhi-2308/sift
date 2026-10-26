import { describe, it, expect } from 'vitest';
import { SpiderTrapDetector } from '../src/frontier/trap-detector.js';

describe('Spider Trap Detector', () => {
  const detector = new SpiderTrapDetector(8, 500, 5);

  it('allows normal web URLs within limits', () => {
    const res = detector.detect('https://example.com/blog/2026/modern-search-architecture', 2);
    expect(res.isTrap).toBe(false);
  });

  it('detects crawl depth exceeding threshold', () => {
    const res = detector.detect('https://example.com/page', 9);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('depth limit exceeded');
  });

  it('detects excessive URL length', () => {
    const longPath = 'a'.repeat(600);
    const res = detector.detect(`https://example.com/${longPath}`, 1);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('URL length exceeds');
  });

  it('detects repeating path segments (3+ repetitions)', () => {
    const res = detector.detect(
      'https://example.com/category/tech/category/tech/category/tech/item',
      2
    );
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('repeating 3+ times');
  });

  it('detects 2-cycle alternating traps', () => {
    const res = detector.detect('https://example.com/dir1/dir2/dir1/dir2/item', 2);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('Repeating 2-cycle');
  });

  it('detects infinite calendar day patterns', () => {
    const res = detector.detect('https://example.com/calendar/2026/10/26/view', 2);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('Calendar day infinite path');
  });

  it('detects runaway pagination beyond index 200', () => {
    const res = detector.detect('https://example.com/news/page/500', 3);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('Pagination page index excessively high');
  });

  it('detects excessive query parameter counts', () => {
    const res = detector.detect('https://example.com/shop?a=1&b=2&c=3&d=4&e=5&f=6', 1);
    expect(res.isTrap).toBe(true);
    expect(res.reason).toContain('Excessive query parameters');
  });
});
