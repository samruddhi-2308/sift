import type {
  AgentActionName,
  AgentObservation,
  InteractiveElement,
  AgentStepRecord,
  AgentRunStatus,
  AgentRunRecord,
  AgentGoalInput,
} from '@sift/core';

export type {
  AgentActionName,
  AgentObservation,
  InteractiveElement,
  AgentStepRecord,
  AgentRunStatus,
  AgentRunRecord,
  AgentGoalInput,
};

export interface AgentActionCall {
  thought: string;
  action: {
    name: AgentActionName;
    args: Record<string, unknown>;
  };
}

export interface PlannerTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface AgentExecutionOptions {
  url: string;
  goal: string;
  schema?: Record<string, unknown>;
  maxSteps?: number;
  tokenBudget?: number;
  timeoutMs?: number;
  allowedDomains?: string[];
  headless?: boolean;
  saveTrace?: boolean;
  allowLocalhost?: boolean;
  useHeuristicPlanner?: boolean;
}

export interface AgentRunResult {
  runId: string;
  status: AgentRunStatus;
  goal: string;
  url: string;
  extraction?: unknown;
  validationErrors?: string[];
  stepsCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  traceUrl?: string;
  error?: string;
}
