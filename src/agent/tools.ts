import type { Page } from "playwright";
import { collectPagePerception } from "../browser/perception.js";
import type { DomAgent } from "../subagents/dom-agent.js";
import type { DomQueryResult, ToolCall, ToolResult, ToolSchema } from "../types.js";

export interface BrowserToolRuntime {
  click: (selector: string) => Promise<{ selector: string }>;
  navigate: (url: string) => Promise<{ title: string; url: string }>;
  queryDom: (question: string) => Promise<DomQueryResult>;
  readPage: (question?: string) => Promise<DomQueryResult>;
  scroll: (direction: string, amount: number) => Promise<{ amount: number; direction: string }>;
  type: (selector: string, text: string) => Promise<{ selector: string; textLength: number }>;
  wait: (seconds: number) => Promise<{ seconds: number }>;
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
    {
      type: "function",
      name: "scroll",
      description: "Scroll the visible page up or down.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down"],
          },
          amount: {
            type: "number",
            description: "Scroll amount in pixels.",
          },
        },
        required: ["direction"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "wait",
      description: "Wait for a short duration so the page can update.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          seconds: {
            type: "number",
            description: "Seconds to wait.",
          },
        },
        required: ["seconds"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "read_page",
      description: "Ask the DOM sub-agent to extract relevant visible page text.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Optional reading goal.",
          },
        },
        required: [],
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
    if (call.name === "scroll") {
      const direction = readRequiredString(call.arguments, "direction");
      const amount = readOptionalNumber(call.arguments, "amount") ?? 700;
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.scroll(direction, amount),
      };
    }
    if (call.name === "wait") {
      const seconds = readOptionalNumber(call.arguments, "seconds") ?? 1;
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.wait(seconds),
      };
    }
    if (call.name === "read_page") {
      const question = readOptionalString(call.arguments, "question");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.readPage(question),
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
    readPage: async (question) => {
      if (!domAgent) {
        throw new Error("DOM sub-agent is not configured");
      }
      return domAgent.query({
        question: question ?? "Extract the relevant visible text from the current page.",
        perception: await collectPagePerception(page, {
          ariaSnapshotTimeoutMs: 5000,
          maxCandidateTextLength: 120,
        }),
      });
    },
    scroll: async (direction, amount) => {
      const deltaY = direction === "up" ? -amount : amount;
      await page.mouse.wheel(0, deltaY);
      return { amount, direction };
    },
    type: async (selector, text) => {
      await resolveLocator(page, selector).fill(text);
      return { selector, textLength: text.length };
    },
    wait: async (seconds) => {
      await page.waitForTimeout(seconds * 1000);
      return { seconds };
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

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }
  return field;
}

function readOptionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  if (field === undefined) {
    return undefined;
  }
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Tool argument "${key}" must be a finite number`);
  }
  return field;
}
