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
  /** Set when the element lives inside an open modal dialog blocking the page. */
  inDialog?: boolean;
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
  /** True when an open modal dialog is blocking the page. */
  dialogOpen?: boolean;
}

export interface DomQueryResult {
  answer: string;
  candidateId?: string;
  candidates?: PerceptionCandidate[];
  confidence: "low" | "medium" | "high";
  objects?: ExtractedObjectDraft[];
  usage?: Usage;
}

export type ExtractedObjectType = "email" | "product" | "vacancy" | "resume" | "other";

export type ObjectStatus =
  | "seen"
  | "opened"
  | "details_extracted"
  | "reviewed"
  | "selected"
  | "rejected"
  | "action_ready"
  | "action_done";

/** Structured item extracted by the DOM sub-agent from the current page. */
export interface ExtractedObjectDraft {
  /** candidateId of the item's per-object action control (delete, apply, add), when visible. */
  actionCandidateId?: string;
  /** candidateId that opens the item's detail view, when clickable. */
  candidateId?: string;
  fields?: Record<string, string>;
  title: string;
  type: ExtractedObjectType;
  url?: string;
}

/** An extracted object tracked across pages with a stable objectId and workflow status. */
export interface MemoryObject {
  actionCandidateId?: string;
  candidateId?: string;
  fields: Record<string, string>;
  objectId: string;
  status: ObjectStatus;
  title: string;
  type: ExtractedObjectType;
  url?: string;
}
