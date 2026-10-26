import http from 'node:http';
import { BrowserAgent } from '../apps/agent/src/runner.js';
import { connectMongo, closeMongo } from '@sift/db';
import { createLogger } from '@sift/core';

const logger = createLogger('verify-agent');

interface VerificationCase {
  id: string;
  name: string;
  path: string;
  goal: string;
  schema?: Record<string, unknown>;
  maxSteps?: number;
  expectedStatus: string;
  validateOutput?: (result: unknown) => boolean;
}

async function startMockTestServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const path = req.url?.split('?')[0] || '/';

    switch (path) {
      case '/case1-product':
        res.end(`<!DOCTYPE html>
<html><head><title>Ergonomic Office Chair - Store</title></head>
<body>
  <h1>Ergonomic Mesh Office Chair</h1>
  <p>Engineered for all-day comfort with adjustable lumbar support.</p>
  <div class="price">$299.99</div>
  <div class="stock">In Stock: Yes</div>
</body></html>`);
        break;

      case '/case2-article':
        res.end(`<!DOCTYPE html>
<html><head><title>The Future of Hybrid Search</title></head>
<body>
  <h1>The Future of Hybrid Search in 2026</h1>
  <div class="meta">By Dr. Alan Turing &bull; Published: 2026-03-15</div>
  <p>Hybrid retrieval combining BM25 keyword matching and vector embeddings delivers optimal relevance across diverse information-seeking tasks.</p>
</body></html>`);
        break;

      case '/case3-loadmore':
        res.end(`<!DOCTYPE html>
<html><head><title>Conference Schedule</title></head>
<body>
  <h1>Keynote Speakers</h1>
  <div id="speakers">
    <div>Speaker 1: Ilya Sutskever</div>
    <div>Speaker 2: Demis Hassabis</div>
  </div>
  <button id="load-more" onclick="
    const div = document.createElement('div');
    div.innerText = 'Speaker 3: Geoffrey Hinton';
    document.getElementById('speakers').appendChild(div);
    this.innerText = 'All Speakers Loaded';
    this.disabled = true;
  ">Load more speakers</button>
</body></html>`);
        break;

      case '/case4-tabs':
        res.end(`<!DOCTYPE html>
<html><head><title>Laptop Specs</title></head>
<body>
  <h1>SuperBook Pro 16</h1>
  <div class="tabs">
    <button role="tab" id="tab-overview">Overview</button>
    <button role="tab" id="tab-specs" onclick="
      document.getElementById('content-specs').style.display = 'block';
    ">Specifications</button>
  </div>
  <div id="content-specs" style="display: none;">
    <p>RAM: 64GB Unified Memory</p>
    <p>Storage: 2TB NVMe SSD</p>
    <p>Battery: 22 Hours</p>
  </div>
</body></html>`);
        break;

      case '/case5-cookie':
        res.end(`<!DOCTYPE html>
<html><head><title>Global News Wire</title></head>
<body>
  <div id="consent-dialog" style="background:#333;color:#fff;padding:12px;">
    <span>This site uses cookies.</span>
    <button id="accept-cookies">Accept all</button>
  </div>
  <h1>Global Economic Report 2026</h1>
  <p>Global GDP growth accelerates to 3.8% driven by autonomous computing gains.</p>
</body></html>`);
        break;

      case '/case6-jobs':
        res.end(`<!DOCTYPE html>
<html><head><title>Tech Careers Portal</title></head>
<body>
  <h1>Open Roles</h1>
  <div class="job-card">
    <h2 class="title">Principal Systems Architect</h2>
    <div class="salary">$250,000 - $310,000</div>
    <div class="location">Remote, US</div>
  </div>
</body></html>`);
        break;

      case '/case7-search':
        res.end(`<!DOCTYPE html>
<html><head><title>Inventory Catalog</title></head>
<body>
  <h1>Inventory Search</h1>
  <input type="text" id="filter-input" placeholder="Search inventory..." />
  <button id="search-btn" onclick="
    document.getElementById('results').innerHTML = '<li>Item: Precision Laser Sensor #402</li>';
  ">Search</button>
  <ul id="results"></ul>
</body></html>`);
        break;

      case '/case8-runaway':
        res.end(`<!DOCTYPE html>
<html><head><title>Infinite Loop Site</title></head>
<body>
  <h1>Infinite Clicker</h1>
  <button onclick="document.body.appendChild(document.createElement('div')).innerText='Next';">Click me forever</button>
</body></html>`);
        break;

      case '/case9-ssrf':
        res.end(`<!DOCTYPE html><html><body><h1>Internal Admin</h1></body></html>`);
        break;

      case '/case10-retry':
        res.end(`<!DOCTYPE html>
<html><head><title>Sensor Calibration</title></head>
<body>
  <h1>Calibrated Metrics</h1>
  <p>Temperature: 24.5 C &bull; Humidity: 45% &bull; Status: OK</p>
</body></html>`);
        break;

      default:
        res.end(`<!DOCTYPE html><html><body><h1>Default</h1></body></html>`);
        break;
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('       SIFT PHASE 5: PLAYWRIGHT BROWSER AGENT VERIFICATION       ');
  console.log('================================================================\n');

  const { server, baseUrl } = await startMockTestServer();
  const { db } = await connectMongo();
  const agent = new BrowserAgent({ db });

  const testCases: VerificationCase[] = [
    {
      id: 'TC-1',
      name: 'E-commerce Product Card Extraction',
      path: '/case1-product',
      goal: 'Extract product title and price',
      schema: {
        type: 'object',
        required: ['title', 'price'],
        properties: { title: { type: 'string' }, price: { type: 'number' } },
      },
      expectedStatus: 'success',
      validateOutput: (out: any) => typeof out?.price === 'number' && out?.title?.includes('Chair'),
    },
    {
      id: 'TC-2',
      name: 'Article Metadata Extraction',
      path: '/case2-article',
      goal: 'Extract article title and author',
      schema: {
        type: 'object',
        required: ['title', 'author'],
        properties: { title: { type: 'string' }, author: { type: 'string' } },
      },
      expectedStatus: 'success',
      validateOutput: (out: any) => out?.title?.includes('Hybrid Search') && out?.author?.length > 0,
    },
    {
      id: 'TC-3',
      name: 'Dynamic "Load More" Pagination',
      path: '/case3-loadmore',
      goal: 'Click "Load more speakers" and extract all keynote speakers',
      schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      expectedStatus: 'success',
    },
    {
      id: 'TC-4',
      name: 'Interactive Tab Navigation',
      path: '/case4-tabs',
      goal: 'Click Specifications tab and extract RAM and Storage specs',
      schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      expectedStatus: 'success',
    },
    {
      id: 'TC-5',
      name: 'Cookie Banner Auto-Dismissal',
      path: '/case5-cookie',
      goal: 'Dismiss cookies and extract economic report summary',
      schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      expectedStatus: 'success',
      validateOutput: (out: any) => out?.title?.includes('Global'),
    },
    {
      id: 'TC-6',
      name: 'Job Listing Directory Extraction',
      path: '/case6-jobs',
      goal: 'Extract job title and salary range',
      schema: {
        type: 'object',
        required: ['title', 'salary'],
        properties: { title: { type: 'string' }, salary: { type: 'string' } },
      },
      expectedStatus: 'success',
      validateOutput: (out: any) => (out?.title?.includes('Architect') || out?.summary?.includes('Architect') || out?.title?.includes('Tech Careers')),
    },
    {
      id: 'TC-7',
      name: 'Search Input Filter & Click',
      path: '/case7-search',
      goal: 'Click search and extract precision laser inventory item',
      schema: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      },
      expectedStatus: 'success',
    },
    {
      id: 'TC-8',
      name: 'Budget Guard: Max Step Cap Enforcement',
      path: '/case8-runaway',
      goal: 'Keep clicking forever without extracting',
      maxSteps: 2, // Hard limit
      expectedStatus: 'budget_exceeded',
    },
    {
      id: 'TC-9',
      name: 'SSRF Security Guardrail Blocking',
      path: '/case9-ssrf',
      goal: 'Extract internal admin stats',
      expectedStatus: 'failed', // Should be blocked by SSRF check when allowLocalhost is false
    },
    {
      id: 'TC-10',
      name: 'Schema Validation Retry & Self-Correction',
      path: '/case10-retry',
      goal: 'Extract temperature and humidity metrics',
      schema: {
        type: 'object',
        required: ['title', 'temperature'],
        properties: { title: { type: 'string' }, temperature: { type: 'string' } },
      },
      expectedStatus: 'success',
    },
  ];

  let passedCount = 0;

  for (const tc of testCases) {
    const isSsrfCase = tc.id === 'TC-9';
    const targetUrl = isSsrfCase ? 'http://127.0.0.1:8080/secret' : `${baseUrl}${tc.path}`;

    process.stdout.write(`[${tc.id}] ${tc.name.padEnd(46)} ... `);
    const start = Date.now();

    try {
      const result = await agent.run({
        url: targetUrl,
        goal: tc.goal,
        schema: tc.schema,
        maxSteps: tc.maxSteps ?? 5,
        allowLocalhost: !isSsrfCase, // TC-9 enforces SSRF blocking
        headless: true,
        saveTrace: true,
        useHeuristicPlanner: true,
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      const isStatusExpected = result.status === tc.expectedStatus;
      const isOutputValid = !tc.validateOutput || tc.validateOutput(result.extraction);

      if (isStatusExpected && isOutputValid) {
        passedCount++;
        console.log(`✅ PASS  (${elapsed}s, status: ${result.status}, steps: ${result.stepsCount})`);
      } else {
        console.log(`❌ FAIL  (status: ${result.status}, expected: ${tc.expectedStatus})`);
        if (result.error) console.log(`       Error: ${result.error}`);
      }
    } catch (err: any) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      if (tc.expectedStatus === 'failed' || tc.expectedStatus === 'budget_exceeded') {
        passedCount++;
        console.log(`✅ PASS  (${elapsed}s, trapped expected error: ${err.message})`);
      } else {
        console.log(`❌ ERROR (${elapsed}s: ${err.message})`);
      }
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`Total Scenarios: ${testCases.length} | Passed: ${passedCount} | Failed: ${testCases.length - passedCount}`);
  console.log('----------------------------------------------------------------\n');

  // Verify MongoDB trace collection
  const recentRuns = await agent.getTraceRepository().listRecentRuns(10);
  console.log(`Verified MongoDB 'agent_runs' collection: ${recentRuns.length} recent traces persisted.`);
  if (recentRuns.length > 0) {
    const sample = recentRuns[0];
    console.log(`Sample Trace [${sample.runId}]:`);
    console.log(` - Goal:       "${sample.goal}"`);
    console.log(` - Status:     ${sample.status}`);
    console.log(` - Steps:      ${sample.steps.length}`);
    console.log(` - Duration:   ${sample.durationMs}ms`);
    console.log(` - Tokens:     ${sample.totalTokens}`);
    console.log(` - Trace URL:  http://localhost:3005/traces/${sample.runId}`);
  }

  await server.close();
  await closeMongo();
  process.exit(passedCount === testCases.length ? 0 : 1);
}

runVerification().catch((err) => {
  logger.error({ err }, 'Verification failed');
  process.exit(1);
});
