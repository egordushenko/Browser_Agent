import { describe, expect, test } from "vitest";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "../src/agent/tools.js";

describe("getToolSchemas", () => {
  test("exposes navigate as a strict generic function tool", () => {
    const schemas = getToolSchemas();

    expect(schemas.map((schema) => schema.name)).toEqual(["navigate", "query_dom", "click", "type"]);
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
    };

    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "search field" } }, runtime);
    await executeToolCall({ id: "c", name: "click", arguments: { selector: "css=#search" } }, runtime);
    await executeToolCall(
      { id: "t", name: "type", arguments: { selector: "css=#search", text: "hot dog" } },
      runtime,
    );

    expect(actions).toEqual(["query:search field", "click:css=#search", "type:css=#search:hot dog"]);
  });
});
