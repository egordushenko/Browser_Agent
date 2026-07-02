import { ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import { AgentContext } from "./context.js";
import type { ObjectMemory } from "./object-memory.js";
import { ProgressTracker } from "./progress.js";
import { isGatedToolName, type SecurityGate } from "./security.js";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "./tools.js";
import type { LLMProvider } from "../llm/provider.js";
import type { CompactObservation, ToolCall, ToolResult, Usage } from "../types.js";

export interface RunAgentStepInput {
  observation: CompactObservation;
  context?: AgentContext;
  onToolCall?: (call: ToolCall) => void;
  provider: LLMProvider;
  runtime: BrowserToolRuntime;
  securityGate?: SecurityGate;
  stepTimeoutMs?: number;
  task: string;
}

export interface RunAgentStepResult {
  text?: string;
  toolCall?: ToolCall;
  toolResult: ToolResult | null;
  usage: Usage;
}

export interface AgentLoopLimits {
  maxConsecutiveErrors: number;
  maxNoProgress: number;
  maxSteps: number;
  stepTimeoutMs: number;
}

export interface RunAgentTaskInput {
  contextOptions?: {
    maxDetailedSteps: number;
    maxTextChars: number;
  };
  limits: AgentLoopLimits;
  objectMemory?: ObjectMemory;
  observe: () => Promise<CompactObservation>;
  onStepResult?: (step: AgentTaskStep, stepIndex: number) => void;
  onToolCall?: (call: ToolCall, stepIndex: number) => void;
  provider: LLMProvider;
  runtime: BrowserToolRuntime;
  securityGate?: SecurityGate;
  task: string;
}

export interface AgentTaskStep {
  observation: CompactObservation;
  text?: string;
  toolCall?: ToolCall;
  toolResult: ToolResult | null;
  usage: Usage;
}

export interface RunAgentTaskResult {
  steps: AgentTaskStep[];
  stopReason: "done" | "max_steps" | "max_consecutive_errors" | "no_progress" | "no_tool_call";
}

export async function runAgentStep(input: RunAgentStepInput): Promise<RunAgentStepResult> {
  const response = await withOptionalTimeout(
    input.provider.complete({
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: input.context
        ? input.context.buildMessages({ task: input.task, observation: input.observation })
        : [
            {
              role: "user",
              content: buildStepMessage(input.task, input.observation),
            },
          ],
      tools: getToolSchemas(),
    }),
    input.stepTimeoutMs,
  );

  if (!response.toolCall) {
    return {
      text: response.text,
      toolCall: undefined,
      toolResult: null,
      usage: response.usage,
    };
  }

  input.onToolCall?.(response.toolCall);

  if (input.securityGate && isGatedToolName(response.toolCall.name)) {
    const candidateId = response.toolCall.arguments.candidateId;
    const target =
      typeof candidateId === "string" ? input.runtime.describeCandidate?.(candidateId) : undefined;
    const review = await input.securityGate.review({
      arguments: response.toolCall.arguments,
      ...(target ? { target } : {}),
      task: input.task,
      title: input.observation.title,
      toolName: response.toolCall.name,
      url: input.observation.url,
    });
    if (!review.allowed) {
      const toolResult: ToolResult = {
        ok: false,
        toolName: response.toolCall.name,
        content:
          `Blocked by security gate: ${review.reason} ` +
          "The user declined confirmation. Do not retry this action; finish with done or ask the user.",
      };
      input.context?.recordToolResult(response.toolCall.name, toolResult);
      return {
        toolCall: response.toolCall,
        toolResult,
        usage: response.usage,
      };
    }
  }

  // ask_user waits for a human answer, so it must not be limited by the step timeout.
  let toolResult: ToolResult;
  try {
    const execution = executeToolCall(response.toolCall, input.runtime);
    toolResult =
      response.toolCall.name === "ask_user" ? await execution : await withOptionalTimeout(execution, input.stepTimeoutMs);
  } catch (error) {
    toolResult = {
      ok: false,
      toolName: response.toolCall.name,
      content: error instanceof Error ? error.message : String(error),
    };
  }
  input.context?.recordToolResult(response.toolCall.name, toolResult);

  return {
    toolCall: response.toolCall,
    toolResult,
    usage: response.usage,
  };
}

export async function runAgentTask(input: RunAgentTaskInput): Promise<RunAgentTaskResult> {
  const context = new AgentContext({
    maxDetailedSteps: input.contextOptions?.maxDetailedSteps ?? 8,
    maxTextChars: input.contextOptions?.maxTextChars ?? 2000,
    objectMemory: input.objectMemory,
  });
  const progress = new ProgressTracker({ maxNoProgress: input.limits.maxNoProgress });
  const steps: AgentTaskStep[] = [];
  let consecutiveErrors = 0;

  for (let index = 0; index < input.limits.maxSteps; index += 1) {
    const observation = await input.observe();
    const step = await runAgentStep({
      context,
      observation,
      onToolCall: (call) => input.onToolCall?.(call, index),
      provider: input.provider,
      runtime: input.runtime,
      securityGate: input.securityGate,
      stepTimeoutMs: input.limits.stepTimeoutMs,
      task: input.task,
    });

    const taskStep: AgentTaskStep = {
      observation,
      ...step,
    };
    steps.push(taskStep);
    input.onStepResult?.(taskStep, index);

    if (!step.toolCall) {
      return { steps, stopReason: "no_tool_call" };
    }

    if (step.toolCall.name === "done" && step.toolResult?.ok) {
      return { steps, stopReason: "done" };
    }

    const progressResult = progress.record({
      actionArgs: step.toolCall.arguments,
      actionName: step.toolCall.name,
      title: observation.title,
      url: observation.url,
    });
    if (progressResult.noProgress) {
      return { steps, stopReason: "no_progress" };
    }

    consecutiveErrors = step.toolResult?.ok === false ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= input.limits.maxConsecutiveErrors) {
      return { steps, stopReason: "max_consecutive_errors" };
    }
  }

  return { steps, stopReason: "max_steps" };
}

async function withOptionalTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Agent step timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildStepMessage(task: string, observation: CompactObservation): string {
  return [
    `Task: ${task}`,
    "Current compact browser observation:",
    JSON.stringify(observation),
  ].join("\n");
}
