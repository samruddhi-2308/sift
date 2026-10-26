import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { normalizeUrl } from '../dedupe/url-normalizer.js';
import { computeSimHash } from '../dedupe/simhash.js';
import type { RenderMode } from '@sift/core';

export interface ParsedDocument {
  title: string;
  text: string;
  textLength: number;
  headings: string[];
  lang: string;
  canonicalUrl?: string;
  contentHash: string;
  outlinks: string[];
  renderMode: RenderMode;
  needsJsRendering: boolean;
}

export class HtmlParser {
  /**
   * Parses HTML content into structured document data, extracting main text via Readability,
   * metadata via Cheerio, and outlinks for crawler frontier discovery.
   */
  parse(html: string, pageUrl: string): ParsedDocument {
    const $ = cheerio.load(html);

    // 1. Language extraction
    const langAttr =
      $('html').attr('lang') || $('meta[http-equiv="content-language"]').attr('content') || 'en';
    const lang = langAttr.split(/[-_]/)[0]?.toLowerCase() || 'en';

    // 2. Title extraction (OG title -> HTML title -> first h1 -> fallback)
    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled Page';

    // 3. Headings extraction (h1, h2, h3)
    const headings: string[] = [];
    $('h1, h2, h3').each((_, el) => {
      const headingText = $(el).text().trim().replace(/\s+/g, ' ');
      if (headingText.length > 2 && headingText.length < 200 && !headings.includes(headingText)) {
        headings.push(headingText);
      }
    });

    // 4. Canonical link
    let canonicalUrl: string | undefined = undefined;
    const rawCanonical = $('link[rel="canonical"]').attr('href');
    if (rawCanonical) {
      const normCanonical = normalizeUrl(rawCanonical, pageUrl);
      if (normCanonical) {
        canonicalUrl = normCanonical.normalizedUrl;
      }
    }

    // 5. Outlink extraction and normalization
    const outlinksSet = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (
        href &&
        !href.startsWith('javascript:') &&
        !href.startsWith('mailto:') &&
        !href.startsWith('tel:')
      ) {
        const norm = normalizeUrl(href, pageUrl);
        if (norm && norm.normalizedUrl !== pageUrl) {
          outlinksSet.add(norm.normalizedUrl);
        }
      }
    });
    const outlinks = Array.from(outlinksSet);

    // 6. SPA / JavaScript render detection heuristic
    const noscriptText = $('noscript').text().toLowerCase();
    const bodyTextRaw = $('body').text().trim();
    const hasEmptyRoot = $('#root, #app, #__next').length > 0 && bodyTextRaw.length < 250;
    const hasJsRequiredNotice =
      noscriptText.includes('enable javascript') || noscriptText.includes('requires javascript');
    const needsJsRendering = hasEmptyRoot || hasJsRequiredNotice;
    const renderMode: RenderMode = needsJsRendering ? 'rendered' : 'static';

    // 7. Main content extraction via Mozilla Readability
    let mainText = '';
    try {
      const dom = new JSDOM(html, { url: pageUrl });
      const reader = new Readability(dom.window.document, {
        charThreshold: 50,
      });
      const article = reader.parse();
      if (article && article.textContent && article.textContent.trim().length > 100) {
        mainText = article.textContent.replace(/\s+/g, ' ').trim();
      }
    } catch {
      // Fallback if JSDOM / Readability throws
    }

    // Cheerio fallback if Readability extracted too little text
    if (!mainText || mainText.length < 100) {
      // Remove noise tags
      $('script, style, noscript, svg, nav, footer, header, form, iframe').remove();
      mainText = $('body').text().replace(/\s+/g, ' ').trim();
    }

    // 8. Compute SimHash for near-duplicate clustering
    const contentHash = computeSimHash(mainText);

    return {
      title,
      text: mainText,
      textLength: mainText.length,
      headings: headings.slice(0, 20),
      lang,
      canonicalUrl,
      contentHash,
      outlinks,
      renderMode,
      needsJsRendering,
    };
  }
}
