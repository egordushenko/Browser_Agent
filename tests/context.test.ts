import { describe, expect, test } from "vitest";
import { AgentContext } from "../src/agent/context.js";
import { ObjectMemory } from "../src/agent/object-memory.js";

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

  test("includes the object memory digest in every step message", () => {
    const objectMemory = new ObjectMemory();
    objectMemory.ingest([
      { title: "Junior Python Engineer", type: "vacancy", fields: { company: "Acme" } },
      { title: "Скидки недели", type: "email" },
    ]);
    const context = new AgentContext({
      maxDetailedSteps: 2,
      maxTextChars: 500,
      objectMemory,
    });

    const messages = context.buildMessages({
      task: "Apply to vacancies",
      observation: { url: "https://example.com", title: "Example", lastToolResult: null },
    });

    expect(messages[1].content).toContain("Known objects");
    expect(messages[1].content).toContain("o1 [vacancy/seen] Junior Python Engineer (company=Acme)");
    expect(messages[1].content).toContain("o2 [email/seen] Скидки недели");
  });

  test("omits the object digest while memory is empty", () => {
    const context = new AgentContext({
      maxDetailedSteps: 2,
      maxTextChars: 500,
      objectMemory: new ObjectMemory(),
    });

    const messages = context.buildMessages({
      task: "Open a page",
      observation: { url: "https://example.com", title: "Example", lastToolResult: null },
    });

    expect(messages[1].content).not.toContain("Known objects");
  });
});
