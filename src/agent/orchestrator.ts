import { ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import { AgentContext } from "./context.js";
import { ProgressTracker } from "./progress.js";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "./tools.js";
import type { LLMProvider } from "../llm/provider.js";
import type { CompactObservation, ToolCall, ToolResult, Usage } from "../types.js";

export interface RunAgentStepInput {
  observation: CompactObservation;
  context?: AgentContext;
  provider: LLMProvider;
  runtime: BrowserToolRuntime;
  task: string;
}

export interface RunAgentStepResult {
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
  observe: () => Promise<CompactObservation>;
  provider: LLMProvider;
  runtime: BrowserToolRuntime;
  task: string;
}

export interface AgentTaskStep {
  observation: CompactObservation;
  toolCall?: ToolCall;
  toolResult: ToolResult | null;
  usage: Usage;
}

export interface RunAgentTaskResult {
  steps: AgentTaskStep[];
  stopReason: "max_steps" | "max_consecutive_errors" | "no_progress" | "no_tool_call";
}

export async function runAgentStep(input: RunAgentStepInput): Promise<RunAgentStepResult> {
  const response = await input.provider.complete({
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
  });

  if (!response.toolCall) {
    return {
      toolCall: undefined,
      toolResult: null,
      usage: response.usage,
    };
  }

  const toolResult = await executeToolCall(response.toolCall, input.runtime);
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
  });
  const progress = new ProgressTracker({ maxNoProgress: input.limits.maxNoProgress });
  const steps: AgentTaskStep[] = [];
  let consecutiveErrors = 0;

  for (let index = 0; index < input.limits.maxSteps; index += 1) {
    const observation = await input.observe();
    const step = await withTimeout(
      runAgentStep({
        context,
        observation,
        provider: input.provider,
        runtime: input.runtime,
        task: input.task,
      }),
      input.limits.stepTimeoutMs,
    );

    steps.push({
      observation,
      ...step,
    });

    if (!step.toolCall) {
      return { steps, stopReason: "no_tool_call" };
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
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
