export interface TrapDetectionResult {
  isTrap: boolean;
  reason?: string;
}

export class SpiderTrapDetector {
  private maxDepth: number;
  private maxUrlLength: number;
  private maxQueryParams: number;

  constructor(maxDepth = 8, maxUrlLength = 1024, maxQueryParams = 8) {
    this.maxDepth = maxDepth;
    this.maxUrlLength = maxUrlLength;
    this.maxQueryParams = maxQueryParams;
  }

  /**
   * Evaluates if a candidate URL represents an infinite spider trap or low-value crawl cycle
   */
  detect(url: string, depth = 0): TrapDetectionResult {
    // 1. Max depth threshold
    if (depth > this.maxDepth) {
      return { isTrap: true, reason: `Crawl depth limit exceeded (${depth} > ${this.maxDepth})` };
    }

    // 2. URL Length threshold
    if (url.length > this.maxUrlLength) {
      return {
        isTrap: true,
        reason: `URL length exceeds safety threshold (${url.length} > ${this.maxUrlLength})`,
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { isTrap: true, reason: 'Malformed URL' };
    }

    // 3. Excessive query parameter count (common in faceted search traps)
    const paramCount = Array.from(parsed.searchParams.keys()).length;
    if (paramCount > this.maxQueryParams) {
      return {
        isTrap: true,
        reason: `Excessive query parameters (${paramCount} > ${this.maxQueryParams})`,
      };
    }

    const segments = parsed.pathname.split('/').filter(Boolean);

    // 4. Repeating path segments (e.g. /category/electronics/category/electronics or /a/b/a/b)
    const seenSegments = new Map<string, number>();
    for (const segment of segments) {
      const lower = segment.toLowerCase();
      const count = (seenSegments.get(lower) || 0) + 1;
      seenSegments.set(lower, count);
      if (count >= 3) {
        return { isTrap: true, reason: `Path segment repeating 3+ times: /${lower}` };
      }
    }

    // Check for 2-segment repeating cycles like /foo/bar/foo/bar
    for (let i = 0; i < segments.length - 3; i++) {
      if (segments[i] === segments[i + 2] && segments[i + 1] === segments[i + 3]) {
        return {
          isTrap: true,
          reason: `Repeating 2-cycle path detected: ${segments[i]}/${segments[i + 1]}`,
        };
      }
    }

    // 5. Calendar and infinite pagination traps
    // e.g., /calendar/2026/05/20/day or page numbers > 1000
    const path = parsed.pathname.toLowerCase();
    if (/\/(calendar|events|archive)\/\d{4}\/\d{2}\/\d{2}/.test(path)) {
      return { isTrap: true, reason: 'Calendar day infinite path detected' };
    }
    const pageMatch = path.match(/\/(?:page|p)\/(\d+)/);
    if (pageMatch && pageMatch[1] && parseInt(pageMatch[1], 10) > 200) {
      return { isTrap: true, reason: `Pagination page index excessively high: ${pageMatch[1]}` };
    }

    return { isTrap: false };
  }
}
