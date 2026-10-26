import { randomBytes } from 'node:crypto';
import { createLogger } from '@sift/core';
import { type Db } from '@sift/db';
import { BrowserSession } from './browser/browser-session.js';
import { BudgetGuard, SecurityGuardError } from './security/guardrails.js';
import { AgentPlanner } from './llm/agent-planner.js';
import { SchemaValidator } from './validation/schema-validator.js';
import { TraceRepository } from './storage/trace-repository.js';
import type {
  AgentExecutionOptions,
  AgentRunRecord,
  AgentRunResult,
  AgentRunStatus,
  AgentStepRecord,
} from './types.js';

const logger = createLogger('browser-agent');

export class BrowserAgent {
  private session: BrowserSession;
  private planner: AgentPlanner;
  private traceRepo: TraceRepository;

  constructor(options: { db?: Db; apiKey?: string; model?: string } = {}) {
    this.session = new BrowserSession();
    this.planner = new AgentPlanner(options.apiKey, options.model);
    this.traceRepo = new TraceRepository(options.db);
  }

  async run(options: AgentExecutionOptions): Promise<AgentRunResult> {
    const runId = `run_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const startTime = Date.now();
    const maxSteps = options.maxSteps ?? 15;
    const tokenBudget = options.tokenBudget ?? 60_000;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const allowedDomains = options.allowedDomains ?? [];

    const guard = new BudgetGuard({ maxSteps, tokenBudget, timeoutMs });
    this.session = new BrowserSession({
      headless: options.headless ?? true,
      allowedDomains,
      allowLocalhost: options.allowLocalhost,
    });

    const runRecord: AgentRunRecord = {
      runId,
      url: options.url,
      goal: options.goal,
      schema: options.schema,
      status: 'running',
      steps: [],
      validationRetries: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      startedAt: new Date(startTime),
      durationMs: 0,
    };

    let finalExtraction: unknown = undefined;
    let finalStatus: AgentRunStatus = 'running';
    let errorMessage: string | undefined = undefined;
    let validationErrors: string[] | undefined = undefined;
    let validationRetries = 0;
    const MAX_VALIDATION_RETRIES = 2;

    try {
      logger.info({ runId, url: options.url, goal: options.goal }, 'Starting browser agent run');
      await this.session.initialize();

      // Initial navigation
      let currentObservation = await this.session.navigate(options.url);

      let stepNum = 1;
      let lastActionSummary: { name: string; args: Record<string, unknown>; result: string } | undefined = undefined;

      while (stepNum <= maxSteps && finalStatus === 'running') {
        const stepStart = Date.now();
        guard.recordStep();

        // Take snapshot for visual trace
        const screenshot = await this.session.takeScreenshot().catch(() => '');

        // Plan next action
        const planResult = await this.planner.planNextAction({
          goal: options.goal,
          url: currentObservation.url,
          schema: options.schema,
          observation: currentObservation,
          stepNumber: stepNum,
          maxSteps,
          previousAction: lastActionSummary,
          validationErrors,
          useHeuristicPlanner: options.useHeuristicPlanner,
        });

        const { call, usage } = planResult;
        guard.recordTokens(usage.totalTokens);
        runRecord.totalTokens += usage.totalTokens;
        runRecord.estimatedCostUsd += usage.estimatedCostUsd;

        logger.info(
          { step: stepNum, action: call.action.name, args: call.action.args },
          `Agent step ${stepNum}: ${call.thought}`
        );

        let actionResult: {
          success: boolean;
          message: string;
          validationErrors?: string[];
        } = {
          success: true,
          message: '',
        };

        const actionName = call.action.name;
        const args = call.action.args || {};

        try {
          switch (actionName) {
            case 'click': {
              const id = Number(args.id);
              actionResult = await this.session.click(id);
              currentObservation = await this.session.observe();
              break;
            }
            case 'type': {
              const id = Number(args.id);
              const text = String(args.text || '');
              actionResult = await this.session.type(id, text);
              currentObservation = await this.session.observe();
              break;
            }
            case 'scroll': {
              const direction = (args.direction === 'up' ? 'up' : 'down') as 'up' | 'down';
              actionResult = await this.session.scroll(direction);
              currentObservation = await this.session.observe();
              break;
            }
            case 'wait_for': {
              const target = args.target !== undefined ? (args.target as string | number) : 1000;
              actionResult = await this.session.waitFor(target);
              currentObservation = await this.session.observe();
              break;
            }
            case 'go_back': {
              actionResult = await this.session.goBack();
              currentObservation = await this.session.observe();
              break;
            }
            case 'extract': {
              const rawData = args.data !== undefined ? args.data : args;
              const validation = SchemaValidator.validate(rawData, options.schema);

              if (validation.valid) {
                finalExtraction = validation.data;
                actionResult = {
                  success: true,
                  message: 'Data successfully extracted and validated against schema.',
                };
                finalStatus = 'success';
              } else {
                validationRetries += 1;
                validationErrors = validation.errors;
                actionResult = {
                  success: false,
                  message: `Schema validation failed (${validationRetries}/${MAX_VALIDATION_RETRIES}): ${validation.errors?.join('; ')}`,
                  validationErrors: validation.errors,
                };

                if (validationRetries > MAX_VALIDATION_RETRIES) {
                  finalStatus = 'validation_failed';
                  finalExtraction = rawData;
                  errorMessage = `Exceeded max schema validation retries: ${validation.errors?.join('; ')}`;
                }
              }
              break;
            }
            case 'finish': {
              finalStatus = 'success';
              actionResult = {
                success: true,
                message: String(args.reason || 'Agent finished task.'),
              };
              break;
            }
            default: {
              actionResult = {
                success: false,
                message: `Unknown action: "${actionName}".`,
              };
              break;
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          actionResult = {
            success: false,
            message: `Action execution error: ${msg}`,
          };
          if (err instanceof SecurityGuardError) {
            errorMessage = msg;
            finalStatus = msg.includes('budget') ? 'budget_exceeded' : 'failed';
          }
        }

        lastActionSummary = {
          name: actionName,
          args,
          result: actionResult.message,
        };

        const stepRecord: AgentStepRecord = {
          stepNumber: stepNum,
          timestamp: new Date(),
          url: currentObservation.url,
          title: currentObservation.title,
          observation: currentObservation,
          action: {
            name: actionName,
            args,
            thought: call.thought,
          },
          actionResult,
          screenshotBase64: screenshot,
          tokens: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          },
          durationMs: Date.now() - stepStart,
        };

        runRecord.steps.push(stepRecord);
        stepNum++;
      }

      if (finalStatus === 'running') {
        if (stepNum > maxSteps) {
          finalStatus = 'budget_exceeded';
          errorMessage = `Exceeded step budget of ${maxSteps} steps without completing extraction.`;
        } else {
          finalStatus = 'failed';
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, runId }, 'Uncaught agent error during execution');
      if (err instanceof SecurityGuardError) {
        finalStatus = msg.includes('budget') ? 'budget_exceeded' : 'failed';
      } else {
        finalStatus = 'failed';
      }
      errorMessage = msg;
    } finally {
      await this.session.close().catch(() => {});

      const durationMs = Date.now() - startTime;
      runRecord.status = finalStatus;
      runRecord.extraction = finalExtraction;
      runRecord.validationErrors = validationErrors;
      runRecord.validationRetries = validationRetries;
      runRecord.completedAt = new Date();
      runRecord.durationMs = durationMs;
      runRecord.error = errorMessage;

      if (options.saveTrace !== false) {
        await this.traceRepo.saveRun(runRecord);
      }
    }

    return {
      runId,
      status: finalStatus,
      goal: options.goal,
      url: options.url,
      extraction: finalExtraction,
      validationErrors,
      stepsCount: runRecord.steps.length,
      totalTokens: runRecord.totalTokens,
      estimatedCostUsd: Number(runRecord.estimatedCostUsd.toFixed(6)),
      durationMs: runRecord.durationMs,
      traceUrl: `/traces/${runId}`,
      error: errorMessage,
    };
  }

  getTraceRepository(): TraceRepository {
    return this.traceRepo;
  }
}
