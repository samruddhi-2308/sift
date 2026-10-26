import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../src/dedupe/url-normalizer.js';

describe('URL Normalizer', () => {
  it('lowercases hostname and strips default ports', () => {
    const res = normalizeUrl('HTTP://EXAMPLE.COM:80/about');
    expect(res).not.toBeNull();
    expect(res?.normalizedUrl).toBe('http://example.com/about');
    expect(res?.hostname).toBe('example.com');
  });

  it('strips hash fragments', () => {
    const res = normalizeUrl('https://example.com/docs#installation-guide');
    expect(res?.normalizedUrl).toBe('https://example.com/docs');
  });

  it('strips tracking and marketing query parameters', () => {
    const res = normalizeUrl(
      'https://example.com/search?utm_source=twitter&q=typescript&fbclid=12345&utm_campaign=winter'
    );
    expect(res?.normalizedUrl).toBe('https://example.com/search?q=typescript');
  });

  it('sorts remaining query parameters alphabetically', () => {
    const res = normalizeUrl('https://example.com/items?z=1&a=2&m=3');
    expect(res?.normalizedUrl).toBe('https://example.com/items?a=2&m=3&z=1');
  });

  it('normalizes trailing slashes on subpaths but preserves root slash', () => {
    const root = normalizeUrl('https://example.com/');
    expect(root?.normalizedUrl).toBe('https://example.com/');

    const sub = normalizeUrl('https://example.com/blog/');
    expect(sub?.normalizedUrl).toBe('https://example.com/blog');
  });

  it('resolves relative URLs against baseUrl', () => {
    const res = normalizeUrl('../pricing', 'https://example.com/products/software');
    expect(res?.normalizedUrl).toBe('https://example.com/pricing');
  });

  it('extracts registrable domain properly', () => {
    const res = normalizeUrl('https://sub.blog.example.co.uk/post-1');
    expect(res?.domain).toBe('example.co.uk');
  });

  it('rejects unsupported protocols', () => {
    expect(normalizeUrl('ftp://files.example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('mailto:test@example.com')).toBeNull();
  });

  it('produces identical 16-hex hash for equivalent URLs with different param order', () => {
    const resA = normalizeUrl('https://example.com/item?b=2&a=1');
    const resB = normalizeUrl('https://example.com/item?a=1&b=2&utm_medium=email');
    expect(resA?.urlHash).toBe(resB?.urlHash);
  });
});
