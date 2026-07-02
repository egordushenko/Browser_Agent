import { ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "./tools.js";
import type { LLMProvider } from "../llm/provider.js";
import type { CompactObservation, ToolResult, Usage } from "../types.js";

export interface RunAgentStepInput {
  observation: CompactObservation;
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
    messages: [
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

  return {
    toolResult: await executeToolCall(response.toolCall, input.runtime),
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
