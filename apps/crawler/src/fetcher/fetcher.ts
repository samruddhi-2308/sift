import { request } from 'undici';
import { validateSafeTarget } from './ssrf-guard.js';
import { config, createLogger, type ErrorClassification } from '@sift/core';

const logger = createLogger('http-fetcher');

export interface FetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  html: string;
  contentType: string;
  durationMs: number;
  sizeBytes: number;
}

export class FetchError extends Error {
  classification: ErrorClassification;
  statusCode?: number;

  constructor(message: string, classification: ErrorClassification, statusCode?: number) {
    super(message);
    this.name = 'FetchError';
    this.classification = classification;
    this.statusCode = statusCode;
  }
}

export class HttpFetcher {
  private userAgent: string;
  private maxSizeBytes: number;

  constructor(userAgent = config.CRAWLER_USER_AGENT, maxSizeBytes = config.MAX_PAGE_SIZE_BYTES) {
    this.userAgent = userAgent;
    this.maxSizeBytes = maxSizeBytes;
  }

  async fetch(targetUrl: string, maxRedirects = 5): Promise<FetchResult> {
    const startTime = Date.now();
    let currentUrl = targetUrl;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const parsed = new URL(currentUrl);

      // 1. SSRF Protection check on target domain / IP
      const ssrfCheck = await validateSafeTarget(parsed.hostname);
      if (!ssrfCheck.safe) {
        throw new FetchError(`SSRF validation rejected target: ${ssrfCheck.reason}`, 'blocked');
      }

      logger.debug({ url: currentUrl }, 'Executing HTTP fetch');

      let response;
      try {
        response = await request(currentUrl, {
          method: 'GET',
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          headersTimeout: 5000,
          bodyTimeout: 10000,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('timeout') ||
          msg.includes('UND_ERR_BODY_TIMEOUT') ||
          msg.includes('UND_ERR_HEADERS_TIMEOUT')
        ) {
          throw new FetchError(`Request timed out: ${msg}`, 'timeout');
        }
        if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
          throw new FetchError(`DNS lookup failed: ${msg}`, 'dns');
        }
        throw new FetchError(`Network error during fetch: ${msg}`, 'other');
      }

      const { statusCode, headers } = response;

      // Handle HTTP redirects (301, 302, 303, 307, 308)
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new FetchError(`Exceeded maximum redirect limit of ${maxRedirects}`, 'blocked');
        }
        const nextUrl = new URL(headers.location as string, currentUrl).toString();
        logger.debug({ from: currentUrl, to: nextUrl, statusCode }, 'Following redirect');
        currentUrl = nextUrl;
        continue;
      }

      // Check HTTP status code errors
      if (statusCode === 429) {
        throw new FetchError('Rate limit exceeded (HTTP 429)', 'rate_limited', 429);
      }
      if (statusCode === 403 || statusCode === 401) {
        throw new FetchError(
          `Access blocked by server (HTTP ${statusCode})`,
          'blocked',
          statusCode
        );
      }
      if (statusCode === 404 || statusCode === 410) {
        throw new FetchError(`Resource not found (HTTP ${statusCode})`, 'not_found', statusCode);
      }
      if (statusCode >= 500) {
        throw new FetchError(
          `Remote server error (HTTP ${statusCode})`,
          'server_error',
          statusCode
        );
      }
      if (statusCode !== 200) {
        throw new FetchError(`Unexpected HTTP status code: ${statusCode}`, 'other', statusCode);
      }

      // Content-type filter: HTML only
      const contentType = (headers['content-type'] as string) || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new FetchError(
          `Skipped non-HTML content-type: ${contentType}`,
          'blocked',
          statusCode
        );
      }

      // Stream body with strict max size enforcement
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of response.body) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bufferChunk.length;
        if (totalBytes > this.maxSizeBytes) {
          throw new FetchError(
            `Page content exceeded maximum size limit of ${this.maxSizeBytes} bytes`,
            'too_large',
            statusCode
          );
        }
        chunks.push(bufferChunk);
      }

      const html = Buffer.concat(chunks).toString('utf-8');
      const durationMs = Date.now() - startTime;

      return {
        url: targetUrl,
        finalUrl: currentUrl,
        statusCode,
        html,
        contentType,
        durationMs,
        sizeBytes: totalBytes,
      };
    }

    throw new FetchError('Exceeded redirect limit', 'blocked');
  }
}
