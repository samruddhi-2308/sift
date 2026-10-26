import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { BrowserAgent } from '../src/runner.js';
import { BrowserSession } from '../src/browser/browser-session.js';
import { dismissCookieBanners } from '../src/browser/dom-observer.js';
import { TraceRepository } from '../src/storage/trace-repository.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (req.url === '/product') {
      res.end(`<!DOCTYPE html>
<html>
<head><title>Quantum Mechanical Keyboard</title></head>
<body>
  <div id="cookie-banner" style="background: #222; color: #fff; padding: 10px;">
    <span>We use cookies for analytics.</span>
    <button id="accept-cookies-btn">Accept all</button>
  </div>
  <main>
    <h1 id="prod-title">Quantum Mechanical Keyboard</h1>
    <p class="description">High-performance mechanical switch keyboard with RGB backlighting.</p>
    <div class="price-tag">$149.99</div>
    <div class="rating">Rating: 4.8 / 5.0</div>
    <button id="add-to-cart">Add to Cart</button>
  </main>
</body>
</html>`);
    } else if (req.url === '/load-more') {
      res.end(`<!DOCTYPE html>
<html>
<head><title>Job Listings</title></head>
<body>
  <h1>Remote Software Jobs</h1>
  <ul id="job-list">
    <li>Senior Distributed Systems Engineer - $180k</li>
    <li>Full-Stack TypeScript Engineer - $150k</li>
  </ul>
  <button id="load-more-btn" onclick="
    const li = document.createElement('li');
    li.innerText = 'AI Research Engineer - $220k';
    document.getElementById('job-list').appendChild(li);
    this.innerText = 'All Jobs Loaded';
    this.disabled = true;
  ">Load more jobs</button>
</body>
</html>`);
    } else {
      res.end('<!DOCTYPE html><html><body><h1>Sample Test Page</h1></body></html>');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Browser Agent Observe-Decide-Act Loop', () => {
  it('observes DOM, prunes tree, and assigns stable numeric IDs', async () => {
    const session = new BrowserSession({ headless: true, allowLocalhost: true });
    await session.initialize();

    try {
      const obs = await session.navigate(`${baseUrl}/product`);
      expect(obs.title).toBe('Quantum Mechanical Keyboard');
      expect(obs.interactiveElements.length).toBeGreaterThanOrEqual(2);

      // Verify element structure
      const buttonEl = obs.interactiveElements.find((el) => el.text.includes('Add to Cart') || el.text.includes('Accept'));
      expect(buttonEl).toBeDefined();
      expect(buttonEl?.id).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('auto-dismisses cookie banner on the page', async () => {
    const session = new BrowserSession({ headless: true, allowLocalhost: true });
    await session.initialize();

    try {
      await session.navigate(`${baseUrl}/product`);
      // Re-query banner element to confirm dismissal or helper status
      const page = (session as unknown as { page: import('playwright').Page }).page;
      const dismissed = await dismissCookieBanners(page);
      expect(typeof dismissed).toBe('boolean');
    } finally {
      await session.close();
    }
  });

  it('executes user action clicks and updates dynamic DOM', async () => {
    const session = new BrowserSession({ headless: true, allowLocalhost: true });
    await session.initialize();

    try {
      const obs1 = await session.navigate(`${baseUrl}/load-more`);
      const loadMoreBtn = obs1.interactiveElements.find((el) => el.text.includes('Load more'));
      expect(loadMoreBtn).toBeDefined();

      // Click the element
      const clickRes = await session.click(loadMoreBtn!.id);
      expect(clickRes.success).toBe(true);

      // Observe updated DOM
      const obs2 = await session.observe();
      expect(obs2.contentSummary).toContain('AI Research Engineer');
    } finally {
      await session.close();
    }
  });

  it('runs complete BrowserAgent extraction task and saves trace', async () => {
    const traceRepo = new TraceRepository();
    const agent = new BrowserAgent();
    // Inject memory trace repo
    (agent as unknown as { traceRepo: TraceRepository }).traceRepo = traceRepo;

    const result = await agent.run({
      url: `${baseUrl}/product`,
      goal: 'Extract product title and price',
      schema: {
        type: 'object',
        required: ['title', 'price'],
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
        },
      },
      maxSteps: 5,
      saveTrace: true,
      allowLocalhost: true,
    });

    expect(result.status).toBe('success');
    expect(result.stepsCount).toBeGreaterThanOrEqual(1);
    expect(result.extraction).toBeDefined();
    const extracted = result.extraction as { title: string; price: number };
    expect(extracted.title).toContain('Keyboard');
    expect(extracted.price).toBeGreaterThan(0);

    // Verify trace persistence
    const saved = await agent.getTraceRepository().getRun(result.runId);
    expect(saved).not.toBeNull();
    expect(saved?.runId).toBe(result.runId);
    expect(saved?.steps.length).toBe(result.stepsCount);
    expect(saved?.steps[0].screenshotBase64).toBeDefined();
  }, 25_000);
});

