import { SECURITY_CLASSIFIER_SYSTEM_PROMPT } from "./prompts.js";
import type { LLMProvider } from "../llm/provider.js";

export const GATED_TOOL_NAMES = ["click", "open_candidate", "type", "navigate"] as const;

export function isGatedToolName(toolName: string): boolean {
  return (GATED_TOOL_NAMES as readonly string[]).includes(toolName);
}

export interface SecurityDecision {
  requiresConfirmation: boolean;
  reason: string;
}

export interface SecurityReviewInput {
  arguments: Record<string, unknown>;
  /** Metadata of the concrete element being activated (label, href, kind), when known. */
  target?: { href?: string; kind: string; label: string };
  task: string;
  title?: string;
  toolName: string;
  url?: string;
}

export interface SecurityReviewResult {
  allowed: boolean;
  reason: string;
}

export interface SecurityGateOptions {
  confirm: (message: string) => Promise<boolean>;
  onDecision?: (decision: SecurityDecision, input: SecurityReviewInput) => void;
  provider: LLMProvider;
}

export class SecurityGate {
  constructor(private readonly options: SecurityGateOptions) {}

  async review(input: SecurityReviewInput): Promise<SecurityReviewResult> {
    const decision = await this.classify(input);
    this.options.onDecision?.(decision, input);

    if (!decision.requiresConfirmation) {
      return { allowed: true, reason: decision.reason };
    }

    const allowed = await this.options.confirm(buildConfirmationMessage(input, decision));
    return { allowed, reason: decision.reason };
  }

  private async classify(input: SecurityReviewInput): Promise<SecurityDecision> {
    const response = await this.options.provider.complete({
      system: SECURITY_CLASSIFIER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            action: { toolName: input.toolName, arguments: input.arguments, target: input.target },
            page: { title: input.title, url: input.url },
            task: input.task,
          }),
        },
      ],
      tools: [],
    });

    return parseSecurityDecision(response.text);
  }
}

export function parseSecurityDecision(text: string | undefined): SecurityDecision {
  // Fail closed: an unreadable classifier answer must trigger confirmation, not skip it.
  if (!text) {
    return { requiresConfirmation: true, reason: "Security classifier returned no answer." };
  }

  try {
    const parsed = JSON.parse(extractJsonPayload(text)) as Partial<SecurityDecision>;
    if (typeof parsed.requiresConfirmation !== "boolean") {
      return { requiresConfirmation: true, reason: "Security classifier answer had no boolean verdict." };
    }
    return {
      requiresConfirmation: parsed.requiresConfirmation,
      reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason : "No reason provided.",
    };
  } catch {
    return { requiresConfirmation: true, reason: "Security classifier answer was not valid JSON." };
  }
}

function extractJsonPayload(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function buildConfirmationMessage(input: SecurityReviewInput, decision: SecurityDecision): string {
  return [
    `The agent wants to run "${input.toolName}" with ${JSON.stringify(input.arguments)}.`,
    ...(input.target ? [`Target element: ${JSON.stringify(input.target)}`] : []),
    `Security check: ${decision.reason}`,
  ].join("\n");
}
