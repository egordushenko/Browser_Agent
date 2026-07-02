import { ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import type { AgentContext } from "./context.js";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "./tools.js";
import type { LLMProvider } from "../llm/provider.js";
import type { CompactObservation, ToolResult, Usage } from "../types.js";

export interface RunAgentStepInput {
  observation: CompactObservation;
  context?: AgentContext;
  provider: LLMProvider;
  runtime: BrowserToolRuntime;
  task: string;
}

export interface RunAgentStepResult {
  toolResult: ToolResult | null;
  usage: Usage;
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
      toolResult: null,
      usage: response.usage,
    };
  }

  const toolResult = await executeToolCall(response.toolCall, input.runtime);
  input.context?.recordToolResult(response.toolCall.name, toolResult);

  return {
    toolResult,
    usage: response.usage,
  };
}

function buildStepMessage(task: string, observation: CompactObservation): string {
  return [
    `Task: ${task}`,
    "Current compact browser observation:",
    JSON.stringify(observation),
  ].join("\n");
}
