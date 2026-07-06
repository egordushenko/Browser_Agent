import type { LLMProvider } from "../llm/provider.js";
import type { DomQueryResult, ExtractedObjectDraft, ExtractedObjectType, PagePerception } from "../types.js";

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
        'Return one flat strict JSON object: {"answer": string, "candidateId": string?, "confidence": "low"|"medium"|"high", "objects": array?}.',
        "Do not nest JSON inside the answer field and do not wrap the object in code fences.",
        "Use candidateId exactly as it appears in candidates when a clickable element is needed.",
        "When the question asks to list, extract, or compare items (emails, products, vacancies, resumes, similar),",
        'fill "objects" with one entry per visible item:',
        '{"type": "email"|"product"|"vacancy"|"resume"|"other", "title": string, "fields": {string: string},',
        ' "candidateId": string?, "actionCandidateId": string?}.',
        "candidateId opens the item's detail view; actionCandidateId is the item's own visible action control.",
        "Both must come from candidates.",
        "Put per-item facts (sender, price, salary, company, requirements) into fields as short strings.",
        "Never invent selectors, URLs, refs, hrefs, or candidate ids.",
        "candidateId values exist ONLY in the candidates array; snapshot text or ref-like markers are never ids.",
        "If an element you need has no entry in candidates, say so explicitly and suggest scrolling",
        "or a narrower question instead of fabricating an id.",
        "A candidate with occurrences > 1 matches several elements at once; call that out as ambiguous",
        "and suggest an intermediate step (e.g. open the specific card first).",
        "If the perception has dialogOpen=true, a modal dialog is currently blocking the page:",
        "describe the dialog first and prefer candidates marked inDialog=true for the next action.",
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

  const objects = parseObjects(parsed.objects);
  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : text,
    candidateId: typeof parsed.candidateId === "string" ? parsed.candidateId : undefined,
    confidence: normalizeConfidence(parsed.confidence),
    ...(objects.length > 0 ? { objects } : {}),
  };
}

interface DomAgentRawResult {
  answer?: unknown;
  candidateId?: unknown;
  confidence?: unknown;
  objects?: unknown;
}

const OBJECT_TYPES: ExtractedObjectType[] = ["email", "product", "vacancy", "resume", "other"];

function parseObjects(value: unknown): ExtractedObjectDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const drafts: ExtractedObjectDraft[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      continue;
    }
    drafts.push({
      ...(typeof raw.actionCandidateId === "string" ? { actionCandidateId: raw.actionCandidateId } : {}),
      ...(typeof raw.candidateId === "string" ? { candidateId: raw.candidateId } : {}),
      fields: parseFields(raw.fields),
      title: raw.title.trim(),
      type: OBJECT_TYPES.includes(raw.type as ExtractedObjectType) ? (raw.type as ExtractedObjectType) : "other",
      ...(typeof raw.url === "string" ? { url: raw.url } : {}),
    });
  }
  return drafts;
}

function parseFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const fields: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue === null || fieldValue === undefined) {
      continue;
    }
    const text = typeof fieldValue === "string" ? fieldValue : String(fieldValue);
    if (text.trim().length > 0) {
      fields[key] = text;
    }
  }
  return fields;
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
