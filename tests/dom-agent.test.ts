import { describe, expect, test } from "vitest";
import { DomAgent } from "../src/subagents/dom-agent.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("DomAgent", () => {
  test("answers a query with selector data from compact perception", async () => {
    const provider: LLMProvider = {
      complete: async (request) => {
        expect(request.tools).toHaveLength(0);
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
});
