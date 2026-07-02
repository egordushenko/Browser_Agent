import type { Page } from "playwright";
import type { ToolCall, ToolResult, ToolSchema } from "../types.js";

export interface BrowserToolRuntime {
  navigate: (url: string) => Promise<{ title: string; url: string }>;
}

export function getToolSchemas(): ToolSchema[] {
  return [
    {
      type: "function",
      name: "navigate",
      description: "Navigate the visible browser to an absolute URL.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute URL to open in the browser.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  ];
}

export async function executeToolCall(call: ToolCall, runtime: BrowserToolRuntime): Promise<ToolResult> {
  try {
    if (call.name === "navigate") {
      const url = readRequiredString(call.arguments, "url");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.navigate(url),
      };
    }

    return {
      ok: false,
      toolName: call.name,
      content: `Unknown tool: ${call.name}`,
    };
  } catch (error) {
    return {
      ok: false,
      toolName: call.name,
      content: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createBrowserToolRuntime(page: Page): BrowserToolRuntime {
  return {
    navigate: async (url) => {
      await page.goto(url);
      return {
        title: await page.title(),
        url: page.url(),
      };
    },
  };
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must be a non-empty string`);
  }
  return field;
}
