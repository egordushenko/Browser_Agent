import type { Page } from "playwright";
import { collectPagePerception } from "../browser/perception.js";
import type { DomAgent } from "../subagents/dom-agent.js";
import type { DomQueryResult, ToolCall, ToolResult, ToolSchema } from "../types.js";

export interface BrowserToolRuntime {
  click: (selector: string) => Promise<{ selector: string }>;
  navigate: (url: string) => Promise<{ title: string; url: string }>;
  queryDom: (question: string) => Promise<DomQueryResult>;
  type: (selector: string, text: string) => Promise<{ selector: string; textLength: number }>;
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
    {
      type: "function",
      name: "query_dom",
      description: "Ask the DOM sub-agent for relevant page text and runtime selectors.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Natural-language question about the current page.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "click",
      description: "Click a selector returned by the DOM sub-agent.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Runtime selector returned by query_dom.",
          },
        },
        required: ["selector"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "type",
      description: "Type text into a selector returned by the DOM sub-agent.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          selector: {
            type: "string",
            description: "Runtime selector returned by query_dom.",
          },
          text: {
            type: "string",
            description: "Text to enter.",
          },
        },
        required: ["selector", "text"],
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
    if (call.name === "query_dom") {
      const question = readRequiredString(call.arguments, "question");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.queryDom(question),
      };
    }
    if (call.name === "click") {
      const selector = readRequiredString(call.arguments, "selector");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.click(selector),
      };
    }
    if (call.name === "type") {
      const selector = readRequiredString(call.arguments, "selector");
      const text = readRequiredString(call.arguments, "text");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.type(selector, text),
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

export function createBrowserToolRuntime(page: Page, domAgent?: DomAgent): BrowserToolRuntime {
  return {
    click: async (selector) => {
      await resolveLocator(page, selector).click();
      return { selector };
    },
    navigate: async (url) => {
      await page.goto(url);
      return {
        title: await page.title(),
        url: page.url(),
      };
    },
    queryDom: async (question) => {
      if (!domAgent) {
        throw new Error("DOM sub-agent is not configured");
      }
      return domAgent.query({
        question,
        perception: await collectPagePerception(page, {
          ariaSnapshotTimeoutMs: 5000,
          maxCandidateTextLength: 120,
        }),
      });
    },
    type: async (selector, text) => {
      await resolveLocator(page, selector).fill(text);
      return { selector, textLength: text.length };
    },
  };
}

function resolveLocator(page: Page, selector: string) {
  if (selector.startsWith("css=")) {
    return page.locator(selector.slice("css=".length));
  }
  if (selector.startsWith("text=")) {
    return page.getByText(selector.slice("text=".length));
  }
  return page.locator(selector);
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must be a non-empty string`);
  }
  return field;
}
