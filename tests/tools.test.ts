import { describe, expect, test } from "vitest";
import { executeToolCall, getToolSchemas, type BrowserToolRuntime } from "../src/agent/tools.js";

describe("getToolSchemas", () => {
  test("exposes navigate as a strict generic function tool", () => {
    const schemas = getToolSchemas();

    expect(schemas).toHaveLength(1);
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
});
