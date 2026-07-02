import type { CompactObservation, Message } from "../types.js";

export interface AgentContextOptions {
  maxDetailedSteps: number;
  maxTextChars: number;
}

export interface BuildMessagesInput {
  observation: CompactObservation;
  task: string;
}

interface ToolHistoryEntry {
  result: unknown;
  toolName: string;
}

export class AgentContext {
  private readonly entries: ToolHistoryEntry[] = [];
  private rollingSummary = "";

  constructor(private readonly options: AgentContextOptions) {}

  recordToolResult(toolName: string, result: unknown): void {
    this.entries.push({
      result,
      toolName,
    });
    this.refreshRollingSummary();
  }

  buildMessages(input: BuildMessagesInput): Message[] {
    const detailedEntries = this.entries.slice(-this.options.maxDetailedSteps);
    const detailedContext = detailedEntries.map((entry) => ({
      result: this.truncate(entry.result),
      toolName: entry.toolName,
    }));

    return [
      {
        role: "user",
        content: `Earlier summary: ${this.rollingSummary || "No earlier steps."}`,
      },
      {
        role: "user",
        content: [
          `Task: ${input.task}`,
          "Current compact browser observation:",
          JSON.stringify(this.truncate(input.observation)),
          "Recent detailed tool results:",
          JSON.stringify(detailedContext),
        ].join("\n"),
      },
    ];
  }

  private refreshRollingSummary(): void {
    const summarizedEntries = this.entries.slice(0, Math.max(0, this.entries.length - this.options.maxDetailedSteps));
    this.rollingSummary = summarizedEntries
      .map((entry) => `${entry.toolName}: ${JSON.stringify(this.truncate(entry.result))}`)
      .join(" | ");
  }

  private truncate(value: unknown): unknown {
    if (typeof value === "string") {
      return truncateForContext(value, this.options.maxTextChars);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.truncate(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.truncate(item)]));
    }
    return value;
  }
}

export function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}
