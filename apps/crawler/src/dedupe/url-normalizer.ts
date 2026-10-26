import { getDomain } from 'tldts';
import crypto from 'node:crypto';

// Common marketing, analytics, and session query parameters to strip
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_reader',
  'fbclid',
  'gclid',
  'gclsrc',
  'msclkid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'ref',
  'source',
  'yclid',
]);

export interface NormalizedUrlResult {
  rawUrl: string;
  normalizedUrl: string;
  urlHash: string; // 16-character hex hash (64-bit equivalent)
  domain: string; // Registrable domain (e.g., example.com)
  hostname: string; // Full hostname (e.g., docs.example.com)
  pathname: string;
}

export function computeUrlHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Normalizes a URL deterministically per RFC 3986 and search engine best practices:
 * 1. Resolves relative URLs against baseUrl
 * 2. Enforces http/https protocols
 * 3. Lowercases hostname and removes default ports (80/443)
 * 4. Strips hash fragments (#...)
 * 5. Removes marketing/tracking query parameters
 * 6. Sorts remaining query parameters alphabetically
 * 7. Normalizes path traversal and trailing slashes
 * 8. Computes 64-bit urlHash and extracts registrable domain
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): NormalizedUrlResult | null {
  try {
    let parsed: URL;
    if (baseUrl) {
      parsed = new URL(rawUrl, baseUrl);
    } else {
      parsed = new URL(rawUrl);
    }

    // Only allow HTTP and HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Hostname to lowercase
    const hostname = parsed.hostname.toLowerCase();
    parsed.hostname = hostname;

    // Remove default ports
    if (
      (parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = '';
    }

    // Remove hash fragment
    parsed.hash = '';

    // Strip tracking parameters and sort query parameters
    const searchParams = new URLSearchParams(parsed.search);
    const keysToDelete: string[] = [];
    for (const key of searchParams.keys()) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.has(lower) || lower.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      searchParams.delete(key);
    }

    // Sort remaining parameters
    searchParams.sort();
    const sortedSearch = searchParams.toString();
    parsed.search = sortedSearch ? `?${sortedSearch}` : '';

    // Normalize path: collapse multiple slashes, resolve traversal
    let pathname = parsed.pathname.replace(/\/+/g, '/');
    // Remove trailing slash unless it is just root '/'
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    const normalizedUrl = parsed.toString();
    const domain = getDomain(normalizedUrl) || hostname;
    const urlHash = computeUrlHash(normalizedUrl);

    return {
      rawUrl,
      normalizedUrl,
      urlHash,
      domain,
      hostname,
      pathname,
    };
  } catch {
    return null;
  }
}
