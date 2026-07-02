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

export interface PerceptionCandidate {
  candidateId: string;
  href?: string;
  kind: "button" | "input" | "link" | "control";
  label: string;
  objectHint?: string;
  /** Set when the selector matches several elements on the page (ambiguous). */
  occurrences?: number;
  role?: string;
  tagName: string;
  text: string;
}

export interface PagePerception {
  ariaSnapshot: string;
  candidates: PerceptionCandidate[];
}

export interface DomQueryResult {
  answer: string;
  candidateId?: string;
  candidates?: PerceptionCandidate[];
  confidence: "low" | "medium" | "high";
  usage?: Usage;
}
