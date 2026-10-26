import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { TraceRepository } from '../storage/trace-repository.js';

export function createTraceViewerServer(traceRepo: TraceRepository): FastifyInstance {
  const app = fastify({ logger: false });

  app.register(cors, { origin: true });

  // JSON API: list runs
  app.get('/api/traces', async (_req, reply) => {
    const runs = await traceRepo.listRecentRuns(50);
    return reply.send(runs);
  });

  // JSON API: get single run
  app.get('/api/traces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await traceRepo.getRun(id);
    if (!run) {
      return reply.status(404).send({ error: 'Run trace not found' });
    }
    return reply.send(run);
  });

  // HTML Dashboard: List runs
  app.get('/traces', async (_req, reply) => {
    const runs = await traceRepo.listRecentRuns(50);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sift Agent Trace Viewer</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.15);
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 2.5rem 1.5rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      background: var(--accent-glow);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.4rem 0.9rem;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.5rem;
    }
    h1 { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
    .subtitle { color: var(--text-muted); font-size: 0.95rem; margin-top: 0.3rem; }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      backdrop-filter: blur(16px);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 1.1rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.9rem;
      vertical-align: middle;
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-failed { background: rgba(239, 68, 68, 0.15); color: var(--error); border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-budget_exceeded { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-validation_failed { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-running { background: rgba(56, 189, 248, 0.15); color: var(--accent); border: 1px solid rgba(56, 189, 248, 0.3); }
    .code-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: #cbd5e1;
      background: rgba(0, 0, 0, 0.3);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
    a.btn-view {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      transition: color 0.15s ease;
    }
    a.btn-view:hover { color: #7dd3fc; text-decoration: underline; }
    .empty-state {
      padding: 4rem 2rem;
      text-align: center;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="logo-badge">Sift Browser Agent</div>
        <h1>Execution Traces</h1>
        <p class="subtitle">Inspecting Observe-Decide-Act loops, schema extractions, and latency metrics</p>
      </div>
      <div>
        <span class="code-pill">Runs Recorded: ${runs.length}</span>
      </div>
    </header>

    <div class="table-container">
      ${
        runs.length === 0
          ? '<div class="empty-state">No agent runs recorded yet. Run <code>pnpm --filter @sift/agent start run</code> to execute your first extraction!</div>'
          : `<table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Goal</th>
            <th>Target URL</th>
            <th>Steps</th>
            <th>Duration</th>
            <th>Tokens</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${runs
            .map(
              (r) => `<tr>
            <td><span class="badge badge-${r.status}">${r.status}</span></td>
            <td style="max-width: 320px; font-weight: 500;">${escapeHtml(r.goal)}</td>
            <td><span class="code-pill">${escapeHtml(truncate(r.url, 40))}</span></td>
            <td><strong>${r.steps.length}</strong></td>
            <td>${(r.durationMs / 1000).toFixed(2)}s</td>
            <td>${r.totalTokens.toLocaleString()}</td>
            <td><a class="btn-view" href="/traces/${r.runId}">View Trace &rarr;</a></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>`
      }
    </div>
  </div>
</body>
</html>`;

    reply.type('text/html').send(html);
  });

  // HTML Step-by-Step Interactive Trace Viewer
  app.get('/traces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await traceRepo.getRun(id);

    if (!run) {
      return reply.status(404).send('Agent run trace not found');
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trace: ${escapeHtml(run.goal)} | Sift Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.9);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.15);
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 2rem 1.5rem;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .nav-bar { margin-bottom: 1.5rem; }
    .nav-bar a { color: var(--accent); text-decoration: none; font-size: 0.9rem; font-weight: 600; }
    .header-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.75rem 2rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1.5rem;
    }
    .goal-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .url-link { color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; word-break: break-all; }
    .meta-pills { display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap; }
    .pill {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--card-border);
      padding: 0.35rem 0.85rem;
      border-radius: 8px;
      font-size: 0.82rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .grid-layout { display: grid; grid-template-columns: 320px 1fr; gap: 2rem; }
    @media (max-width: 900px) { .grid-layout { grid-template-columns: 1fr; } }
    .steps-nav {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-height: calc(100vh - 250px);
      overflow-y: auto;
      padding-right: 0.5rem;
    }
    .step-btn {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1rem;
      color: var(--text);
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
    }
    .step-btn:hover { border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.05); }
    .step-btn.active {
      border-color: var(--accent);
      background: var(--accent-glow);
    }
    .step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem; }
    .step-num { font-weight: 700; font-size: 0.85rem; color: var(--accent); }
    .action-badge {
      background: rgba(255, 255, 255, 0.08);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
    }
    .step-time { font-size: 0.75rem; color: var(--text-muted); }
    .detail-view {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
    }
    .thought-bubble {
      background: rgba(56, 189, 248, 0.08);
      border-left: 4px solid var(--accent);
      border-radius: 0 8px 8px 0;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      font-style: italic;
      color: #e0f2fe;
      line-height: 1.5;
    }
    .screenshot-box {
      margin-bottom: 1.5rem;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      background: #000;
    }
    .screenshot-box img { width: 100%; height: auto; display: block; max-height: 480px; object-fit: contain; }
    .section-title { font-size: 0.95rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.75rem; }
    pre {
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid var(--card-border);
      padding: 1rem;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      overflow-x: auto;
      margin-bottom: 1.5rem;
      color: #e2e8f0;
    }
    .final-box {
      margin-top: 2rem;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 1.5rem;
    }
    .copy-btn {
      background: var(--accent);
      color: #000;
      font-weight: 600;
      border: none;
      padding: 0.45rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="nav-bar">
      <a href="/traces">&larr; Back to all runs</a>
    </div>

    <div class="header-card">
      <div>
        <h1 class="goal-title">${escapeHtml(run.goal)}</h1>
        <div class="url-link">${escapeHtml(run.url)}</div>
        <div class="meta-pills">
          <span class="pill">Status: <strong style="color: ${run.status === 'success' ? 'var(--success)' : 'var(--error)'}">${run.status}</strong></span>
          <span class="pill">Steps: <strong>${run.steps.length}</strong></span>
          <span class="pill">Duration: <strong>${(run.durationMs / 1000).toFixed(2)}s</strong></span>
          <span class="pill">Tokens: <strong>${run.totalTokens.toLocaleString()}</strong></span>
          <span class="pill">Cost: <strong>$${run.estimatedCostUsd.toFixed(5)}</strong></span>
        </div>
      </div>
    </div>

    <div class="grid-layout">
      <!-- Steps List Sidebar -->
      <div class="steps-nav">
        ${run.steps
          .map(
            (step, idx) => `
          <button class="step-btn ${idx === 0 ? 'active' : ''}" onclick="showStep(${idx})" id="step-btn-${idx}">
            <div class="step-header">
              <span class="step-num">Step ${step.stepNumber}</span>
              <span class="action-badge">${step.action.name}</span>
            </div>
            <div class="step-time">${step.durationMs}ms &bull; ${step.tokens?.totalTokens ?? 0} tokens</div>
          </button>`
          )
          .join('')}
      </div>

      <!-- Detail View of Selected Step -->
      <div class="detail-view" id="step-detail-container">
        <!-- Rendered via JS -->
      </div>
    </div>

    <!-- Final Extraction Panel -->
    ${
      run.extraction
        ? `<div class="final-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h3 style="color: var(--success);">Final Extracted Structured Data</h3>
        <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('extracted-json').innerText); alert('Copied JSON!');">Copy JSON</button>
      </div>
      <pre id="extracted-json">${escapeHtml(JSON.stringify(run.extraction, null, 2))}</pre>
    </div>`
        : ''
    }
  </div>

  <script>
    const stepsData = ${JSON.stringify(run.steps)};

    function showStep(idx) {
      document.querySelectorAll('.step-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === idx);
      });

      const s = stepsData[idx];
      if (!s) return;

      const container = document.getElementById('step-detail-container');
      const screenshotHtml = s.screenshotBase64
        ? '<div class="screenshot-box"><img src="' + s.screenshotBase64 + '" alt="Step ' + s.stepNumber + ' Screenshot" /></div>'
        : '';

      container.innerHTML = '<div>' +
        '<div style="display: flex; justify-content: space-between; margin-bottom: 1.5rem;">' +
          '<h2>Step ' + s.stepNumber + ': Action &rarr; <span class="action-badge" style="font-size: 1rem;">' + s.action.name + '</span></h2>' +
          '<span class="pill">' + s.durationMs + 'ms</span>' +
        '</div>' +
        '<div class="thought-bubble"><strong>Agent Reasoning:</strong> ' + escapeHtml(s.action.thought || 'Executing planned action.') + '</div>' +
        screenshotHtml +
        '<div class="section-title">Action Parameters & Execution Result</div>' +
        '<pre>Action: ' + JSON.stringify(s.action, null, 2) + '\\nResult: ' + JSON.stringify(s.actionResult, null, 2) + '</pre>' +
        '<div class="section-title">Observation Context</div>' +
        '<pre>URL: ' + s.observation.url + '\\nTitle: ' + s.observation.title + '\\nInteractive Elements: ' + s.observation.interactiveElements.length + ' found\\n\\nVisible Content Excerpt:\\n' + escapeHtml(s.observation.contentSummary) + '</pre>' +
      '</div>';
    }

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // Initialize with first step
    if (stepsData.length > 0) {
      showStep(0);
    }
  </script>
</body>
</html>`;

    reply.type('text/html').send(html);
  });

  return app;
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text: string, len: number): string {
  if (text.length <= len) return text;
  return text.slice(0, len) + '...';
}
