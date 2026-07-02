import { describe, expect, test } from "vitest";
import { AgentContext } from "../src/agent/context.js";

describe("AgentContext", () => {
  test("keeps recent detailed steps and rolls older steps into a bounded summary", () => {
    const context = new AgentContext({
      maxDetailedSteps: 2,
      maxTextChars: 30,
    });

    context.recordToolResult("navigate", { url: "https://example.com", title: "Example Domain" });
    context.recordToolResult("query_dom", {
      answer: "A very long page answer that must be truncated before entering model context",
    });
    context.recordToolResult("click", { selector: "css=#search" });

    const messages = context.buildMessages({
      task: "Find search",
      observation: {
        url: "https://example.com",
        title: "Example Domain",
        lastToolResult: null,
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain("Earlier summary");
    expect(messages[0].content).toContain("navigate");
    expect(messages[1].content).toContain("query_dom");
    expect(messages[1].content).toContain("click");
    expect(messages[1].content).toContain("A very long page answer that m...");
    expect(messages[1].content).toContain("Find search");
  });
});
