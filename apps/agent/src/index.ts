import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { connectMongo } from '@sift/db';
import { createLogger } from '@sift/core';
import { BrowserAgent } from './runner.js';
import { TraceRepository } from './storage/trace-repository.js';
import { createTraceViewerServer } from './viewer/server.js';

export * from './types.js';
export * from './runner.js';
export * from './browser/browser-session.js';
export * from './browser/dom-observer.js';
export * from './security/guardrails.js';
export * from './validation/schema-validator.js';
export * from './storage/trace-repository.js';
export * from './viewer/server.js';

const logger = createLogger('agent-cli');

async function main() {
  const program = new Command();

  program
    .name('sift-agent')
    .description('Sift Playwright Browser Agent for interactive page navigation and structured extraction');

  program
    .command('run')
    .description('Run autonomous browser extraction agent')
    .requiredOption('-u, --url <url>', 'Target page URL')
    .requiredOption('-g, --goal <goal>', 'Agent extraction goal')
    .option('-s, --schema <schema>', 'JSON Schema string or path to schema file')
    .option('-m, --max-steps <number>', 'Maximum allowed steps (default: 15)', '15')
    .option('--no-headless', 'Run browser in non-headless (visible) mode')
    .action(async (opts) => {
      let schemaObj: Record<string, unknown> | undefined = undefined;
      if (opts.schema) {
        if (fs.existsSync(opts.schema)) {
          schemaObj = JSON.parse(fs.readFileSync(opts.schema, 'utf-8'));
        } else {
          try {
            schemaObj = JSON.parse(opts.schema);
          } catch {
            logger.error('Failed to parse --schema argument as JSON');
            process.exit(1);
          }
        }
      }

      let dbInstance;
      try {
        const client = await connectMongo();
        dbInstance = client.db;
      } catch (err) {
        logger.warn({ err }, 'MongoDB unavailable; running with in-memory trace store');
      }

      const agent = new BrowserAgent({ db: dbInstance });
      logger.info({ url: opts.url, goal: opts.goal }, 'Launching agent execution...');

      const result = await agent.run({
        url: opts.url,
        goal: opts.goal,
        schema: schemaObj,
        maxSteps: parseInt(opts.maxSteps, 10),
        headless: opts.headless,
      });

      console.log('\n=== AGENT EXECUTION RESULT ===');
      console.log(`Status:         ${result.status}`);
      console.log(`Steps taken:    ${result.stepsCount}`);
      console.log(`Duration:       ${(result.durationMs / 1000).toFixed(2)}s`);
      console.log(`Tokens used:    ${result.totalTokens} (est. $${result.estimatedCostUsd.toFixed(5)})`);
      console.log(`Trace View:     http://localhost:3005${result.traceUrl}`);
      if (result.extraction) {
        console.log('\nExtracted Data:');
        console.log(JSON.stringify(result.extraction, null, 2));
      }
      if (result.error) {
        console.log(`\nError:          ${result.error}`);
      }

      process.exit(result.status === 'success' ? 0 : 1);
    });

  program
    .command('viewer')
    .description('Start interactive web trace viewer for inspected runs')
    .option('-p, --port <number>', 'Port to bind viewer on (default: 3005)', '3005')
    .action(async (opts) => {
      const port = parseInt(opts.port, 10);
      let dbInstance;
      try {
        const client = await connectMongo();
        dbInstance = client.db;
      } catch (err) {
        logger.warn({ err }, 'MongoDB unavailable; viewer will show in-memory runs only');
      }

      const traceRepo = new TraceRepository(dbInstance);
      const app = createTraceViewerServer(traceRepo);

      await app.listen({ port, host: '0.0.0.0' });
      logger.info(`Trace viewer listening on http://localhost:${port}/traces`);
      console.log(`Trace viewer ready at: http://localhost:${port}/traces`);
    });

  await program.parseAsync(process.argv);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFilePath === path.resolve(process.argv[1])) {
  main().catch((err) => {
    logger.error({ err }, 'Agent CLI execution failed');
    process.exit(1);
  });
}
