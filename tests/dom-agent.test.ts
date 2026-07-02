import { describe, expect, test } from "vitest";
import { DomAgent } from "../src/subagents/dom-agent.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("DomAgent", () => {
  test("answers a query with candidateId data from compact perception", async () => {
    const provider: LLMProvider = {
      complete: async (request) => {
        expect(request.tools).toHaveLength(0);
        expect(request.system).toContain("Use candidateId exactly as it appears in candidates");
        expect(request.system).toContain("Never invent selectors, URLs, refs, hrefs, or candidate ids");
        expect(request.messages[0].content).toContain("find search field");
        expect(request.messages[0].content).toContain("c1");
        return {
          text: JSON.stringify({
            answer: "Search field is available.",
            candidateId: "c1",
            confidence: "high",
          }),
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        };
      },
    };

    const agent = new DomAgent(provider);
    const result = await agent.query({
      question: "find search field",
      perception: {
        ariaSnapshot: '- textbox "Search" [ref=e2]',
        candidates: [
          {
            tagName: "input",
            label: "Search",
            candidateId: "c1",
            kind: "input",
            text: "",
          },
        ],
      },
    });

    expect(result).toEqual({
      answer: "Search field is available.",
      candidateId: "c1",
      confidence: "high",
      usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
    });
  });

  test("tolerates fenced or malformed sub-agent output instead of failing the tool", async () => {
    const fencedProvider: LLMProvider = {
      complete: async () => ({
        text: '```json\n{"answer": "Found it.", "candidateId": "c2", "confidence": "medium"}\n```',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }),
    };
    const fenced = await new DomAgent(fencedProvider).query({
      question: "find button",
      perception: { ariaSnapshot: "-", candidates: [] },
    });
    expect(fenced).toMatchObject({ answer: "Found it.", candidateId: "c2", confidence: "medium" });

    const brokenProvider: LLMProvider = {
      complete: async () => ({
        text: "The page has no such element.",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }),
    };
    const broken = await new DomAgent(brokenProvider).query({
      question: "find button",
      perception: { ariaSnapshot: "-", candidates: [] },
    });
    expect(broken).toMatchObject({ answer: "The page has no such element.", confidence: "low" });
  });

  test("unwraps double-encoded JSON and numeric confidence from the sub-agent", async () => {
    const provider: LLMProvider = {
      complete: async () => ({
        text: JSON.stringify({
          answer: JSON.stringify({ answer: "Резюме найдено", candidateId: "c3", confidence: 0.86 }),
          confidence: "low",
        }),
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }),
    };

    const result = await new DomAgent(provider).query({
      question: "find resume",
      perception: { ariaSnapshot: "-", candidates: [] },
    });

    expect(result).toMatchObject({
      answer: "Резюме найдено",
      candidateId: "c3",
      confidence: "high",
    });
  });
});
