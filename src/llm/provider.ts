import type { Message, ToolCall, ToolSchema, Usage } from "../types.js";

export interface LLMRequest {
  system: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface LLMResponse {
  text?: string;
  toolCall?: ToolCall;
  usage: Usage;
}

export interface LLMProvider {
  complete(req: LLMRequest): Promise<LLMResponse>;
}
