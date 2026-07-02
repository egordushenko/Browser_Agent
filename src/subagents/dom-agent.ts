import type { LLMProvider } from "../llm/provider.js";
import type { DomQueryResult, PagePerception } from "../types.js";

export interface DomAgentQueryInput {
  perception: PagePerception;
  question: string;
}

export class DomAgent {
  constructor(private readonly provider: LLMProvider) {}

  async query(input: DomAgentQueryInput): Promise<DomQueryResult> {
    const response = await this.provider.complete({
      system: [
        "You are a DOM perception sub-agent.",
        "Answer using only the compact page representation provided by the caller.",
        "Return strict JSON with fields: answer, selector, confidence.",
        "Use selectors exactly as they appear in candidates when a selector is needed.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            perception: input.perception,
          }),
        },
      ],
      tools: [],
    });

    const parsed = parseDomAgentJson(response.text);
    return {
      ...parsed,
      usage: response.usage,
    };
  }
}

function parseDomAgentJson(text: string | undefined): Omit<DomQueryResult, "usage"> {
  if (!text) {
    return {
      answer: "DOM sub-agent returned no text.",
      confidence: "low",
    };
  }

  const parsed = JSON.parse(text) as Partial<DomQueryResult>;
  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : text,
    confidence: isConfidence(parsed.confidence) ? parsed.confidence : "low",
    selector: typeof parsed.selector === "string" ? parsed.selector : undefined,
  };
}

function isConfidence(value: unknown): value is DomQueryResult["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}
