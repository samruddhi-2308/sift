import type { Page } from 'playwright';
import type { AgentObservation, InteractiveElement } from '../types.js';

/**
 * Extracts a pruned accessibility / interactive DOM observation from a live Playwright page.
 * Assigns stable numeric IDs to elements and attaches `data-sift-id` attributes to the DOM.
 */
export async function observePage(page: Page): Promise<AgentObservation> {
  // First, auto-dismiss cookie banners if any are detected
  await dismissCookieBanners(page).catch(() => {});

  const observation = await page.evaluate((): {
    url: string;
    title: string;
    interactiveElements: InteractiveElement[];
    contentSummary: string;
    scrollPosition: { x: number; y: number; maxY: number };
  } => {
    // 1. Remove previous sift IDs
    document.querySelectorAll('[data-sift-id]').forEach((el) => {
      el.removeAttribute('data-sift-id');
    });

    function isVisible(el: HTMLElement): boolean {
      if (!el.isConnected) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) return false;
      return true;
    }

    function getCleanText(el: Element): string {
      const text =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        (el as HTMLInputElement).value ||
        (el as HTMLElement).innerText ||
        '';
      return text.replace(/\s+/g, ' ').trim().slice(0, 100);
    }

    // Candidate selector for interactive elements
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="switch"], [tabindex="0"], [onclick]'
      )
    );

    let nextId = 1;
    const interactiveElements: InteractiveElement[] = [];

    for (const el of candidates) {
      if (!isVisible(el)) continue;

      // Skip nested interactives (e.g. icon inside button)
      const parentInteractive = el.parentElement?.closest(
        'a, button, [role="button"], [role="link"], [role="tab"]'
      );
      if (parentInteractive && parentInteractive !== el) {
        continue;
      }

      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : undefined);
      const text = getCleanText(el);
      const inputEl = el as HTMLInputElement;

      const item: InteractiveElement = {
        id: nextId,
        tag,
        role,
        text,
        type: inputEl.type || undefined,
        href: el.getAttribute('href') || undefined,
        placeholder: inputEl.placeholder || undefined,
        value: inputEl.value ? inputEl.value.slice(0, 50) : undefined,
        disabled: (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
      };

      el.setAttribute('data-sift-id', String(nextId));
      interactiveElements.push(item);
      nextId++;

      if (nextId > 80) break; // Limit elements per observation to prevent huge prompts
    }

    // 2. Extract content summary from headings, text blocks, and leaf text nodes
    const contentNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, h5, h6, p, li, td, th, dt, dd, [class*="price" i], [class*="meta" i], [class*="author" i], [class*="stock" i], [class*="rating" i], [class*="job" i], [class*="title" i], [class*="salary" i], [class*="location" i], [class*="desc" i], [class*="spec" i]'
      )
    );
    const textPieces: string[] = [];
    let textLength = 0;

    for (const node of contentNodes) {
      if (!isVisible(node)) continue;
      const t = node.innerText.replace(/\s+/g, ' ').trim();
      if (t.length > 2 && !textPieces.includes(t)) {
        textPieces.push(t);
        textLength += t.length;
        if (textLength > 3000) break;
      }
    }

    // Capture any leaf div/span containing critical data not caught by standard tags
    const leafNodes = Array.from(document.querySelectorAll<HTMLElement>('div, span, b, strong, em'));
    for (const leaf of leafNodes) {
      if (leaf.children.length === 0 && isVisible(leaf)) {
        const t = leaf.innerText.replace(/\s+/g, ' ').trim();
        if (t.length > 2 && !textPieces.includes(t)) {
          textPieces.push(t);
          textLength += t.length;
          if (textLength > 3000) break;
        }
      }
    }

    const contentSummary = textPieces.slice(0, 35).join('\n');

    return {
      url: window.location.href,
      title: document.title || 'Untitled Page',
      interactiveElements,
      contentSummary,
      scrollPosition: {
        x: window.scrollX,
        y: window.scrollY,
        maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      },
    };
  });

  return observation;
}

/**
 * Attempts to auto-dismiss common cookie consent banners and overlays.
 */
export async function dismissCookieBanners(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const consentKeywords = [
      'accept all',
      'accept cookies',
      'i accept',
      'agree',
      'i agree',
      'allow all',
      'got it',
      'accept',
      'okay',
      'ok',
    ];

    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"]'));
    for (const btn of buttons) {
      const text = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase().trim();
      if (consentKeywords.includes(text)) {
        // Check if inside a dialog/banner container
        const container = btn.closest('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [role="dialog"], [role="alertdialog"]');
        if (container || text === 'accept all' || text === 'allow all') {
          btn.click();
          return true;
        }
      }
    }
    return false;
  });
}
