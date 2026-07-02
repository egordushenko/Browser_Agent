import { describe, expect, test } from "vitest";
import { runAgentStep } from "../src/agent/orchestrator.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("runAgentStep", () => {
  test("asks the provider for one tool call and executes navigate", async () => {
    const requests: Parameters<LLMProvider["complete"]>[0][] = [];
    const provider: LLMProvider = {
      complete: async (request) => {
        requests.push(request);
        return {
          toolCall: {
            id: "call-1",
            name: "navigate",
            arguments: { url: "https://example.com" },
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    };

    const result = await runAgentStep({
      provider,
      task: "Open example.com",
      observation: {
        url: "about:blank",
        title: "",
        lastToolResult: null,
      },
      runtime: {
        navigate: async (url) => ({ url, title: "Example Domain" }),
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].tools.map((tool) => tool.name)).toEqual(["navigate"]);
    expect(requests[0].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("Open example.com"),
    });
    expect(result.toolResult).toMatchObject({
      ok: true,
      toolName: "navigate",
      content: { url: "https://example.com" },
    });
    expect(result.usage.totalTokens).toBe(15);
  });
});
