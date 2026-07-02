export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface ToolSchema {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  strict: true;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompactObservation {
  url: string;
  title: string;
  lastToolResult: unknown | null;
}

export interface ToolResult {
  ok: boolean;
  toolName: string;
  content: unknown;
}
