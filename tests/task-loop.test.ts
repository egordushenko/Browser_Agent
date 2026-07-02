import { describe, expect, test } from "vitest";
import { runAgentTask } from "../src/agent/orchestrator.js";
import type { BrowserToolRuntime } from "../src/agent/tools.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("runAgentTask", () => {
  test("keeps tool errors in context and lets the provider choose a recovery step", async () => {
    const providerCalls: string[] = [];
    const provider: LLMProvider = {
      complete: async (request) => {
        providerCalls.push(request.messages.map((message) => message.content).join("\n"));
        if (providerCalls.length === 1) {
          return {
            toolCall: { id: "call-1", name: "click", arguments: { selector: "css=#missing" } },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return {
          toolCall: { id: "call-2", name: "query_dom", arguments: { question: "Find the search field again" } },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };
    const runtime: BrowserToolRuntime = {
      click: async () => {
        throw new Error("selector not found");
      },
      navigate: async (url) => ({ url, title: "Example" }),
      queryDom: async () => ({ answer: "Use css=#search", selector: "css=#search", confidence: "high" }),
      readPage: async () => ({ answer: "Page", confidence: "medium" }),
      scroll: async (direction, amount) => ({ direction, amount }),
      type: async (selector, text) => ({ selector, textLength: text.length }),
      wait: async (seconds) => ({ seconds }),
    };

    const result = await runAgentTask({
      limits: {
        maxConsecutiveErrors: 3,
        maxNoProgress: 3,
        maxSteps: 2,
        stepTimeoutMs: 1000,
      },
      observe: async () => ({
        url: "https://example.com",
        title: "Example",
        lastToolResult: null,
      }),
      provider,
      runtime,
      task: "Recover from a stale selector",
    });

    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolResult).toMatchObject({ ok: false, content: "selector not found" });
    expect(result.steps[1].toolResult).toMatchObject({ ok: true, toolName: "query_dom" });
    expect(providerCalls[1]).toContain("selector not found");
  });
});
