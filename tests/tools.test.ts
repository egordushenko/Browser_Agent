import { describe, expect, test } from "vitest";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "../src/agent/tools.js";

describe("getToolSchemas", () => {
  test("exposes navigate as a strict generic function tool", () => {
    const schemas = getToolSchemas();

    expect(schemas.map((schema) => schema.name)).toEqual([
      "navigate",
      "query_dom",
      "click",
      "type",
      "scroll",
      "wait",
      "read_page",
      "screenshot",
      "ask_user",
      "done",
    ]);
    expect(schemas[0]).toMatchObject({
      type: "function",
      name: "navigate",
      strict: true,
      parameters: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
      },
    });
  });

  test("strict schemas list every property as required (OpenAI strict-mode invariant)", () => {
    for (const schema of getToolSchemas()) {
      const propertyKeys = Object.keys(schema.parameters.properties).sort();
      const required = [...(schema.parameters.required ?? [])].sort();
      expect(required, `tool ${schema.name}`).toEqual(propertyKeys);
    }
  });

  test("null arguments for nullable fields fall back to defaults", async () => {
    const actions: string[] = [];
    const runtime: BrowserToolRuntime = {
      navigate: async () => {
        throw new Error("unexpected");
      },
      queryDom: async () => {
        throw new Error("unexpected");
      },
      click: async () => {
        throw new Error("unexpected");
      },
      type: async () => {
        throw new Error("unexpected");
      },
      scroll: async (direction, amount) => {
        actions.push(`scroll:${direction}:${amount}`);
        return { direction, amount };
      },
      wait: async (seconds) => ({ seconds }),
      readPage: async (question) => {
        actions.push(`read:${question ?? "default"}`);
        return { answer: "Page text", confidence: "medium" };
      },
      askUser: async () => {
        throw new Error("unexpected");
      },
      done: async () => {
        throw new Error("unexpected");
      },
    };

    const scrolled = await executeToolCall(
      { id: "s", name: "scroll", arguments: { direction: "down", amount: null } },
      runtime,
    );
    const read = await executeToolCall({ id: "r", name: "read_page", arguments: { question: null } }, runtime);

    expect(scrolled.ok).toBe(true);
    expect(read.ok).toBe(true);
    expect(actions).toEqual(["scroll:down:700", "read:default"]);
  });
});

describe("executeToolCall", () => {
  test("runs navigate through the browser runtime", async () => {
    const navigated: string[] = [];
    const runtime: BrowserToolRuntime = {
      navigate: async (url) => {
        navigated.push(url);
        return { url, title: "Example Domain" };
      },
      queryDom: async () => {
        throw new Error("unexpected");
      },
      click: async () => {
        throw new Error("unexpected");
      },
      type: async () => {
        throw new Error("unexpected");
      },
      scroll: async () => {
        throw new Error("unexpected");
      },
      wait: async () => {
        throw new Error("unexpected");
      },
      readPage: async () => {
        throw new Error("unexpected");
      },
      askUser: async () => {
        throw new Error("unexpected");
      },
      done: async () => {
        throw new Error("unexpected");
      },
    };

    const result = await executeToolCall(
      {
        id: "call-1",
        name: "navigate",
        arguments: { url: "https://example.com" },
      },
      runtime,
    );

    expect(navigated).toEqual(["https://example.com"]);
    expect(result).toEqual({
      ok: true,
      toolName: "navigate",
      content: {
        url: "https://example.com",
        title: "Example Domain",
      },
    });
  });

  test("delegates query_dom, click, and type to the browser runtime", async () => {
    const actions: string[] = [];
    const runtime: BrowserToolRuntime = {
      navigate: async () => {
        throw new Error("unexpected");
      },
      queryDom: async (question) => {
        actions.push(`query:${question}`);
        return { answer: "Found", selector: "css=#search", confidence: "high" };
      },
      click: async (selector) => {
        actions.push(`click:${selector}`);
        return { selector };
      },
      type: async (selector, text) => {
        actions.push(`type:${selector}:${text}`);
        return { selector, textLength: text.length };
      },
      scroll: async (direction, amount) => {
        actions.push(`scroll:${direction}:${amount}`);
        return { direction, amount };
      },
      wait: async (seconds) => {
        actions.push(`wait:${seconds}`);
        return { seconds };
      },
      readPage: async (question) => {
        actions.push(`read:${question ?? ""}`);
        return { answer: "Page text", confidence: "medium" };
      },
      askUser: async (question) => {
        actions.push(`ask:${question}`);
        return { question };
      },
      done: async (summary) => {
        actions.push(`done:${summary}`);
        return { summary };
      },
    };

    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "search field" } }, runtime);
    await executeToolCall({ id: "c", name: "click", arguments: { selector: "css=#search" } }, runtime);
    await executeToolCall(
      { id: "t", name: "type", arguments: { selector: "css=#search", text: "hot dog" } },
      runtime,
    );
    await executeToolCall({ id: "s", name: "scroll", arguments: { direction: "down", amount: 500 } }, runtime);
    await executeToolCall({ id: "w", name: "wait", arguments: { seconds: 2 } }, runtime);
    await executeToolCall({ id: "r", name: "read_page", arguments: { question: "visible prices" } }, runtime);
    await executeToolCall({ id: "a", name: "ask_user", arguments: { question: "Need address?" } }, runtime);
    await executeToolCall({ id: "d", name: "done", arguments: { summary: "Finished" } }, runtime);

    expect(actions).toEqual([
      "query:search field",
      "click:css=#search",
      "type:css=#search:hot dog",
      "scroll:down:500",
      "wait:2",
      "read:visible prices",
      "ask:Need address?",
      "done:Finished",
    ]);
  });
});
