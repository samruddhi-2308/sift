import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { SecurityGuardError, validateUrlAgainstSSRF, isDomainAllowed } from '../security/guardrails.js';
import { observePage } from './dom-observer.js';
import type { AgentObservation } from '../types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('browser-session');

export interface BrowserSessionOptions {
  headless?: boolean;
  allowedDomains?: string[];
  navigationTimeoutMs?: number;
  allowLocalhost?: boolean;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly headless: boolean;
  private readonly allowedDomains: string[];
  private readonly navigationTimeoutMs: number;
  private readonly allowLocalhost: boolean;

  constructor(options: BrowserSessionOptions = {}) {
    this.headless = options.headless ?? true;
    this.allowedDomains = options.allowedDomains ?? [];
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 20_000;
    this.allowLocalhost = options.allowLocalhost ?? false;
  }

  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 SiftBot/1.0 (+https://github.com/sift/sift)',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      acceptDownloads: false, // Prevent downloads
    });

    // Provide esbuild/tsx compatibility shim for evaluate
    await this.context.addInitScript(
      'window.__name = function(fn) { return fn; }; globalThis.__name = window.__name;'
    );

    // Block unexpected file downloads
    this.context.on('page', (p) => {
      p.on('download', (download) => {
        logger.warn({ url: download.url() }, 'Blocked file download');
        download.cancel().catch(() => {});
      });
      p.on('filechooser', (dialog) => {
        logger.warn('Dismissed file picker dialog');
        dialog.setFiles([]).catch(() => {});
      });
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(10_000);
    this.page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
  }

  async navigate(url: string): Promise<AgentObservation> {
    await this.ensurePage();

    // 1. SSRF Validation (bypassed only if allowLocalhost is explicitly enabled)
    if (!this.allowLocalhost) {
      const ssrfCheck = validateUrlAgainstSSRF(url);
      if (!ssrfCheck.valid) {
        throw new SecurityGuardError(`SSRF Violation: ${ssrfCheck.reason}`);
      }
    }

    // 2. Domain Allowlist Check
    if (this.allowedDomains.length > 0 && !isDomainAllowed(url, this.allowedDomains)) {
      throw new SecurityGuardError(`Domain violation: navigation to ${url} is not permitted by allowlist`);
    }

    logger.info({ url }, 'Navigating to URL');
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs });
    
    // Quick wait for dynamic JS hydration with a 2s cap
    await this.page!.waitForLoadState('networkidle').catch(() => {});

    return await this.observe();
  }

  async observe(): Promise<AgentObservation> {
    await this.ensurePage();
    return await observePage(this.page!);
  }

  async click(id: number): Promise<{ success: boolean; message: string }> {
    await this.ensurePage();
    const selector = `[data-sift-id="${id}"]`;
    const locator = this.page!.locator(selector);

    const count = await locator.count();
    if (count === 0) {
      return { success: false, message: `Element [${id}] not found in current page DOM.` };
    }

    // Check if element is disabled
    const isDisabled = await locator.first().evaluate((el) => {
      return (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
    });
    if (isDisabled) {
      return { success: false, message: `Element [${id}] is disabled.` };
    }

    // Perform click
    await locator.first().click({ timeout: 5000 });

    // Wait for network idle or DOM mutations
    await this.page!.waitForLoadState('networkidle').catch(() => {});
    await this.page!.waitForTimeout(300);

    // Verify current URL against allowlist if navigation occurred
    const currentUrl = this.page!.url();
    if (this.allowedDomains.length > 0 && !isDomainAllowed(currentUrl, this.allowedDomains)) {
      throw new SecurityGuardError(`Domain violation: navigation led to unauthorized domain: ${currentUrl}`);
    }

    return { success: true, message: `Clicked element [${id}].` };
  }

  async type(id: number, text: string): Promise<{ success: boolean; message: string }> {
    await this.ensurePage();
    const selector = `[data-sift-id="${id}"]`;
    const locator = this.page!.locator(selector);

    const count = await locator.count();
    if (count === 0) {
      return { success: false, message: `Input element [${id}] not found.` };
    }

    // Security check: Refuse to type into sensitive/credential fields
    const isSensitive = await locator.first().evaluate((el) => {
      const input = el as HTMLInputElement;
      return (
        input.type === 'password' ||
        /password|passwd|secret|creditcard|cc_num|cvv|cvc|ssn/i.test(
          `${input.type} ${input.name} ${input.id} ${input.placeholder}`
        )
      );
    });

    if (isSensitive) {
      throw new SecurityGuardError(`Blocked typing attempt: element [${id}] appears to be a sensitive credential field.`);
    }

    await locator.first().fill(text);
    return { success: true, message: `Typed "${text}" into element [${id}].` };
  }

  async scroll(direction: 'up' | 'down'): Promise<{ success: boolean; message: string }> {
    await this.ensurePage();
    await this.page!.evaluate((dir) => {
      const delta = dir === 'down' ? window.innerHeight * 0.75 : -window.innerHeight * 0.75;
      window.scrollBy({ top: delta, behavior: 'instant' });
    }, direction);

    await this.page!.waitForTimeout(300);
    return { success: true, message: `Scrolled ${direction}.` };
  }

  async waitFor(target: string | number): Promise<{ success: boolean; message: string }> {
    await this.ensurePage();
    if (typeof target === 'number') {
      const waitMs = Math.min(Math.max(100, target), 5000);
      await this.page!.waitForTimeout(waitMs);
      return { success: true, message: `Waited for ${waitMs}ms.` };
    } else {
      await this.page!.waitForSelector(target, { timeout: 5000 });
      return { success: true, message: `Waited for selector: "${target}".` };
    }
  }

  async goBack(): Promise<{ success: boolean; message: string }> {
    await this.ensurePage();
    await this.page!.goBack({ timeout: 5000 }).catch(() => {});
    await this.page!.waitForTimeout(300);
    return { success: true, message: 'Navigated back to previous page.' };
  }

  async takeScreenshot(): Promise<string> {
    await this.ensurePage();
    try {
      const buffer = await this.page!.screenshot({
        type: 'jpeg',
        quality: 60,
      });
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  getPageUrl(): string {
    return this.page ? this.page.url() : '';
  }

  getPageTitle(): Promise<string> {
    return this.page ? this.page.title() : Promise.resolve('');
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  private async ensurePage(): Promise<void> {
    if (!this.page || !this.context || !this.browser) {
      await this.initialize();
    }
  }
}
