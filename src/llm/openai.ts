import OpenAI from "openai";
import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.js";
import type { ToolCall, Usage } from "../types.js";

export interface OpenAIResponsesClient {
  responses: {
    create: (request: unknown) => Promise<{
      output?: unknown[];
      output_text?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    }>;
  };
}

export interface OpenAIProviderOptions {
  apiKey: string;
  client?: OpenAIResponsesClient;
  model: string;
}

interface FunctionCallOutput {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;

  constructor(options: OpenAIProviderOptions) {
    this.model = options.model;
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
      }) as unknown as OpenAIResponsesClient);
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [{ role: "system", content: req.system }, ...req.messages],
      tools: req.tools,
      tool_choice: "auto",
    });

    return {
      text: response.output_text,
      toolCall: parseFunctionCall(response.output),
      usage: parseUsage(response.usage),
    };
  }
}

function parseFunctionCall(output: unknown[] | undefined): ToolCall | undefined {
  const call = output?.find(isFunctionCallOutput);
  if (!call) {
    return undefined;
  }

  return {
    id: call.call_id,
    name: call.name,
    arguments: JSON.parse(call.arguments) as Record<string, unknown>,
  };
}

function isFunctionCallOutput(value: unknown): value is FunctionCallOutput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<FunctionCallOutput>;
  return (
    candidate.type === "function_call" &&
    typeof candidate.call_id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.arguments === "string"
  );
}

function parseUsage(usage: Awaited<ReturnType<OpenAIResponsesClient["responses"]["create"]>>["usage"]): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}
