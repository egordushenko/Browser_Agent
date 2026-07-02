import { describe, expect, test } from "vitest";
import { DomAgent } from "../src/subagents/dom-agent.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("DomAgent", () => {
  test("answers a query with selector data from compact perception", async () => {
    const provider: LLMProvider = {
      complete: async (request) => {
        expect(request.tools).toHaveLength(0);
        expect(request.system).toContain("Prefer role/css/id/data-testid/name/aria-label selectors over text selectors");
        expect(request.system).toContain("Do not return an ambiguous candidate as selector");
        expect(request.messages[0].content).toContain("find search field");
        expect(request.messages[0].content).toContain("css=#search");
        return {
          text: JSON.stringify({
            answer: "Search field is available.",
            selector: "css=#search",
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
            selector: "css=#search",
            selectorSource: "id",
          },
        ],
      },
    });

    expect(result).toEqual({
      answer: "Search field is available.",
      selector: "css=#search",
      confidence: "high",
      usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
    });
  });

  test("tolerates fenced or malformed sub-agent output instead of failing the tool", async () => {
    const fencedProvider: LLMProvider = {
      complete: async () => ({
        text: '```json\n{"answer": "Found it.", "selector": "css=#go", "confidence": "medium"}\n```',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }),
    };
    const fenced = await new DomAgent(fencedProvider).query({
      question: "find button",
      perception: { ariaSnapshot: "-", candidates: [] },
    });
    expect(fenced).toMatchObject({ answer: "Found it.", selector: "css=#go", confidence: "medium" });

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
          answer: JSON.stringify({ answer: "Резюме найдено", selector: "text=AI-first Product Engineer", confidence: 0.86 }),
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
      selector: "text=AI-first Product Engineer",
      confidence: "high",
    });
  });
});
