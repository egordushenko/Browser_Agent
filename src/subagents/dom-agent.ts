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
        'Return one flat strict JSON object: {"answer": string, "candidateId": string?, "confidence": "low"|"medium"|"high"}.',
        "Do not nest JSON inside the answer field and do not wrap the object in code fences.",
        "Use candidateId exactly as it appears in candidates when a clickable element is needed.",
        "Never invent selectors, URLs, refs, hrefs, or candidate ids.",
        "A candidate with occurrences > 1 matches several elements at once; call that out as ambiguous",
        "and suggest an intermediate step (e.g. open the specific card first).",
        "Do not return an ambiguous candidateId.",
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

  let parsed: DomAgentRawResult;
  try {
    parsed = JSON.parse(extractJsonPayload(text)) as DomAgentRawResult;
  } catch {
    // A malformed sub-agent answer is still useful text; do not fail the whole tool call.
    return { answer: text, confidence: "low" };
  }

  // Small models sometimes double-encode and put the real JSON payload into the answer field.
  if (typeof parsed.answer === "string" && parsed.candidateId === undefined) {
    const inner = parsed.answer.trim();
    if (inner.startsWith("{")) {
      try {
        const unwrapped = JSON.parse(inner) as DomAgentRawResult;
        if (unwrapped && typeof unwrapped.answer === "string") {
          parsed = unwrapped;
        }
      } catch {
        // keep the outer object
      }
    }
  }

  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : text,
    candidateId: typeof parsed.candidateId === "string" ? parsed.candidateId : undefined,
    confidence: normalizeConfidence(parsed.confidence),
  };
}

interface DomAgentRawResult {
  answer?: unknown;
  candidateId?: unknown;
  confidence?: unknown;
}

function normalizeConfidence(value: unknown): DomQueryResult["confidence"] {
  if (isConfidence(value)) {
    return value;
  }
  // Models occasionally return a numeric score instead of the requested enum.
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.7) {
      return "high";
    }
    if (value >= 0.4) {
      return "medium";
    }
  }
  return "low";
}

function extractJsonPayload(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function isConfidence(value: unknown): value is DomQueryResult["confidence"] {
  return value === "low" || value === "medium" || value === "high";
}
