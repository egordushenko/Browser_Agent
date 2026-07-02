import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { CandidateRegistry } from "../browser/candidate-registry.js";
import { collectPagePerceptionWithRegistry } from "../browser/perception.js";
import {
  assertExecutable,
  assertSelectable,
  BATCH_ACTIONS,
  missingCheckpointsForDone,
  type BatchAction,
} from "./checkpoints.js";
import { isAffirmativeAnswer } from "./confirmation.js";
import type { ObjectMemory } from "./object-memory.js";
import type { DomAgent } from "../subagents/dom-agent.js";
import type { DomQueryResult, MemoryObject, ToolCall, ToolResult, ToolSchema } from "../types.js";

export interface BatchExecutionResult {
  action: BatchAction;
  results: Array<{ objectId: string; outcome: string }>;
}

export interface CandidateDescription {
  href?: string;
  kind: string;
  label: string;
}

export interface BrowserToolRuntime {
  askUser: (question: string) => Promise<{ question: string; answer?: string }>;
  click: (candidateId: string) => Promise<{ candidateId: string }>;
  /** Metadata of a known candidate for logging and security review; undefined when unknown. */
  describeCandidate?: (candidateId: string) => CandidateDescription | undefined;
  confirmBatch?: (summary: string) => Promise<{ confirmed: boolean; objectIds: string[] }>;
  done: (summary: string, incompleteReason?: string) => Promise<{ summary: string; incompleteReason?: string }>;
  executeBatch?: (action: BatchAction, objectIds: string[]) => Promise<BatchExecutionResult>;
  navigate: (url: string) => Promise<{ title: string; url: string }>;
  openCandidate: (candidateId: string) => Promise<{ candidateId: string; href?: string }>;
  proposeSelection?: (
    objectType: string,
    objectIds: string[],
    reason: string,
  ) => Promise<{ proposed: Array<{ objectId: string; title: string }>; reason: string }>;
  queryDom: (question: string) => Promise<DomQueryResult>;
  readPage: (question?: string) => Promise<DomQueryResult>;
  screenshot?: (fullPage: boolean) => Promise<{ path: string }>;
  scroll: (direction: string, amount: number) => Promise<{ amount: number; direction: string }>;
  type: (candidateId: string, text: string) => Promise<{ candidateId: string; textLength: number }>;
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
      description: "Ask the DOM sub-agent for relevant page facts and clickable candidate ids.",
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
      description: "Click a candidateId returned by query_dom for the current page.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          candidateId: {
            type: "string",
            description: "candidateId returned by query_dom for the current page.",
          },
        },
        required: ["candidateId"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "open_candidate",
      description: "Open a link/card candidateId returned by query_dom for the current page.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          candidateId: {
            type: "string",
            description: "candidateId returned by query_dom for the current page.",
          },
        },
        required: ["candidateId"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "type",
      description: "Type text into a candidateId returned by query_dom for the current page.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          candidateId: {
            type: "string",
            description: "candidateId returned by query_dom for the current page.",
          },
          text: {
            type: "string",
            description: "Text to enter.",
          },
        },
        required: ["candidateId", "text"],
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
            type: ["number", "null"],
            description: "Scroll amount in pixels; null for the default.",
          },
        },
        required: ["direction", "amount"],
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
            type: ["string", "null"],
            description: "Reading goal; null for a general extraction.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "screenshot",
      description: "Capture a screenshot of the current page into a local file for the visible log.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          full_page: {
            type: ["boolean", "null"],
            description: "Capture the full scrollable page instead of the viewport; null for viewport.",
          },
        },
        required: ["full_page"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "propose_selection",
      description:
        "Select reviewed objects (by objectId) for a batch action. Objects must have been opened/reviewed first.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          objectType: {
            type: "string",
            enum: ["email", "product", "vacancy", "resume", "other"],
            description: "Type shared by all selected objects.",
          },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: "objectIds from query_dom results.",
          },
          reason: {
            type: "string",
            description: "Why exactly these objects match the task.",
          },
        },
        required: ["objectType", "objectIds", "reason"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "confirm_batch",
      description: "Show the currently selected objects to the user and ask them to confirm the batch.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short human-readable description of what will happen to the selected objects.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "execute_batch",
      description:
        "Execute one action for confirmed objects by objectId. Destructive actions require a confirmed batch.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [...BATCH_ACTIONS],
          },
          objectIds: {
            type: "array",
            items: { type: "string" },
            description: "objectIds to act on.",
          },
        },
        required: ["action", "objectIds"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "ask_user",
      description: "Pause and ask the user a question in the terminal; returns their answer.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Question the user must answer before the task can continue.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "done",
      description:
        "Finish the task with a short factual report. Blocked while a proposed/confirmed batch is unfinished " +
        "unless incomplete_reason honestly explains what was not done and why.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Final report for the user.",
          },
          incomplete_reason: {
            type: ["string", "null"],
            description: "Honest reason why pending checkpoints cannot be completed; null when everything required is done.",
          },
        },
        required: ["summary", "incomplete_reason"],
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
      const candidateId = readRequiredString(call.arguments, "candidateId");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.click(candidateId),
      };
    }
    if (call.name === "open_candidate") {
      const candidateId = readRequiredString(call.arguments, "candidateId");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.openCandidate(candidateId),
      };
    }
    if (call.name === "type") {
      const candidateId = readRequiredString(call.arguments, "candidateId");
      const text = readRequiredString(call.arguments, "text");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.type(candidateId, text),
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
    if (call.name === "screenshot") {
      if (!runtime.screenshot) {
        return {
          ok: false,
          toolName: call.name,
          content: "screenshot is not available in this session",
        };
      }
      const fullPage = readOptionalBoolean(call.arguments, "full_page") ?? false;
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.screenshot(fullPage),
      };
    }
    if (call.name === "propose_selection") {
      if (!runtime.proposeSelection) {
        return { ok: false, toolName: call.name, content: "propose_selection is not available in this session" };
      }
      const objectType = readRequiredString(call.arguments, "objectType");
      const objectIds = readRequiredStringArray(call.arguments, "objectIds");
      const reason = readRequiredString(call.arguments, "reason");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.proposeSelection(objectType, objectIds, reason),
      };
    }
    if (call.name === "confirm_batch") {
      if (!runtime.confirmBatch) {
        return { ok: false, toolName: call.name, content: "confirm_batch is not available in this session" };
      }
      const summary = readRequiredString(call.arguments, "summary");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.confirmBatch(summary),
      };
    }
    if (call.name === "execute_batch") {
      if (!runtime.executeBatch) {
        return { ok: false, toolName: call.name, content: "execute_batch is not available in this session" };
      }
      const action = readRequiredString(call.arguments, "action");
      if (!(BATCH_ACTIONS as readonly string[]).includes(action)) {
        throw new Error(`Unknown batch action "${action}". Valid actions: ${BATCH_ACTIONS.join(", ")}`);
      }
      const objectIds = readRequiredStringArray(call.arguments, "objectIds");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.executeBatch(action as BatchAction, objectIds),
      };
    }
    if (call.name === "ask_user") {
      const question = readRequiredString(call.arguments, "question");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.askUser(question),
      };
    }
    if (call.name === "done") {
      const summary = readRequiredString(call.arguments, "summary");
      const incompleteReason = readOptionalString(call.arguments, "incomplete_reason");
      return {
        ok: true,
        toolName: call.name,
        content: await runtime.done(summary, incompleteReason),
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

export interface BrowserToolRuntimeOptions {
  allowedNavigationUrls?: string[];
  askUser?: (question: string) => Promise<string>;
  objectMemory?: ObjectMemory;
  screenshotDir?: string;
}

export type PageSource = Page | (() => Page);

export function createBrowserToolRuntime(
  pageSource: PageSource,
  domAgent?: DomAgent,
  options?: BrowserToolRuntimeOptions,
): BrowserToolRuntime {
  // New tabs opened by target=_blank links must not leave the agent acting on a stale page.
  const getPage = typeof pageSource === "function" ? pageSource : () => pageSource;
  let screenshotCounter = 0;
  let candidateRegistry = CandidateRegistry.empty();
  return {
    askUser: async (question) => {
      if (!options?.askUser) {
        throw new Error("ask_user is not available in this session");
      }
      return { question, answer: await options.askUser(question) };
    },
    click: async (candidateId) => {
      const candidate = candidateRegistry.get(candidateId);
      await (await resolveLocator(getPage(), candidate.selector)).click();
      options?.objectMemory?.markOpenedByCandidate(candidateId);
      return { candidateId };
    },
    describeCandidate: (candidateId) => {
      try {
        const candidate = candidateRegistry.get(candidateId);
        return {
          ...(candidate.href ? { href: candidate.href } : {}),
          kind: candidate.kind,
          label: candidate.label,
        };
      } catch {
        return undefined;
      }
    },
    confirmBatch: async (summary) => {
      const memory = requireObjectMemory(options);
      if (!options?.askUser) {
        throw new Error("confirm_batch requires an interactive user session");
      }
      const selected = memory.list({ status: "selected" });
      if (selected.length === 0) {
        throw new Error("No selected objects to confirm; run propose_selection first.");
      }
      const answer = await options.askUser(
        [
          summary,
          `Batch objects: ${selected.map((object) => `${object.objectId} "${object.title}"`).join("; ")}`,
          "Confirm batch? [y/N] ",
        ].join("\n"),
      );
      const confirmed = isAffirmativeAnswer(answer);
      for (const object of selected) {
        memory.setStatus(object.objectId, confirmed ? "action_ready" : "rejected");
      }
      return { confirmed, objectIds: selected.map((object) => object.objectId) };
    },
    done: async (summary, incompleteReason) => {
      if (options?.objectMemory && !incompleteReason?.trim()) {
        const missing = missingCheckpointsForDone(options.objectMemory);
        if (missing.length > 0) {
          throw new Error(
            `Cannot finish yet, missing checkpoints:\n${missing.join("\n")}\n` +
              "Either complete them, or ask the user, or call done again with incomplete_reason honestly explaining the gap.",
          );
        }
      }
      return { summary, ...(incompleteReason ? { incompleteReason } : {}) };
    },
    executeBatch: async (action, objectIds) => {
      const memory = requireObjectMemory(options);
      const results: BatchExecutionResult["results"] = [];
      for (const objectId of objectIds) {
        const object = memory.get(objectId);
        assertExecutable(object, action);
        if (action === "stop_before_payment") {
          results.push({ objectId, outcome: "stopped_before_payment" });
          continue;
        }
        const controlId = object.actionCandidateId ?? object.candidateId;
        if (!controlId) {
          throw new Error(
            `Object ${objectId} has no known action control; re-run query_dom on the page where its control is visible. ` +
              `Executed so far: ${JSON.stringify(results)}`,
          );
        }
        const candidate = candidateRegistry.get(controlId);
        await (await resolveLocator(getPage(), candidate.selector)).click();
        memory.setStatus(objectId, "action_done");
        results.push({ objectId, outcome: "action_done" });
      }
      return { action, results };
    },
    screenshot: async (fullPage) => {
      const dir = options?.screenshotDir ?? ".screenshots";
      await fs.mkdir(dir, { recursive: true });
      screenshotCounter += 1;
      const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..*$/, "");
      const filePath = path.join(dir, `screenshot-${stamp}-${screenshotCounter}.png`);
      await getPage().screenshot({ path: filePath, fullPage });
      return { path: filePath };
    },
    navigate: async (url) => {
      assertNavigationAllowed(url, options?.allowedNavigationUrls ?? [], candidateRegistry);
      const page = getPage();
      await page.goto(url);
      return {
        title: await page.title(),
        url: page.url(),
      };
    },
    openCandidate: async (candidateId) => {
      const candidate = candidateRegistry.get(candidateId);
      await (await resolveLocator(getPage(), candidate.selector)).click();
      options?.objectMemory?.markOpenedByCandidate(candidateId);
      return { candidateId, href: candidate.href };
    },
    proposeSelection: async (objectType, objectIds, reason) => {
      const memory = requireObjectMemory(options);
      const objects = objectIds.map((objectId) => memory.get(objectId));
      for (const object of objects) {
        if (object.type !== objectType) {
          throw new Error(`Object ${object.objectId} has type "${object.type}", not "${objectType}".`);
        }
        assertSelectable(object);
      }
      for (const object of objects) {
        memory.setStatus(object.objectId, "selected");
      }
      return {
        proposed: objects.map((object) => ({ objectId: object.objectId, title: object.title })),
        reason,
      };
    },
    queryDom: async (question) => {
      const { perception, registry } = await collectPagePerceptionWithRegistry(getPage(), {
        ariaSnapshotTimeoutMs: 5000,
        maxCandidateTextLength: 120,
      });
      candidateRegistry = registry;
      if (!domAgent) {
        return {
          answer: "Collected current page candidates.",
          candidates: perception.candidates,
          confidence: "medium",
        };
      }
      const result = await domAgent.query({
        question,
        perception,
      });
      return {
        ...result,
        ...ingestObjects(result, options?.objectMemory),
        candidates: perception.candidates,
      };
    },
    readPage: async (question) => {
      const { perception, registry } = await collectPagePerceptionWithRegistry(getPage(), {
        ariaSnapshotTimeoutMs: 5000,
        maxCandidateTextLength: 120,
      });
      candidateRegistry = registry;
      if (!domAgent) {
        return {
          answer: perception.ariaSnapshot,
          candidates: perception.candidates,
          confidence: "medium",
        };
      }
      const result = await domAgent.query({
        question: question ?? "Extract the relevant visible text from the current page.",
        perception,
      });
      return {
        ...result,
        ...ingestObjects(result, options?.objectMemory),
        candidates: perception.candidates,
      };
    },
    scroll: async (direction, amount) => {
      const deltaY = direction === "up" ? -amount : amount;
      await getPage().mouse.wheel(0, deltaY);
      return { amount, direction };
    },
    type: async (candidateId, text) => {
      const candidate = candidateRegistry.get(candidateId);
      await (await resolveLocator(getPage(), candidate.selector)).fill(text);
      return { candidateId, textLength: text.length };
    },
    wait: async (seconds) => {
      await getPage().waitForTimeout(seconds * 1000);
      return { seconds };
    },
  };
}

function requireObjectMemory(options: BrowserToolRuntimeOptions | undefined): ObjectMemory {
  if (!options?.objectMemory) {
    throw new Error("Object memory is not configured for this session");
  }
  return options.objectMemory;
}

// Replace raw drafts with tracked memory objects so the orchestrator sees stable
// objectIds and workflow statuses instead of page-scoped snippets.
function ingestObjects(result: DomQueryResult, memory: ObjectMemory | undefined): { objects?: MemoryObject[] } {
  if (!memory || !result.objects || result.objects.length === 0) {
    return {};
  }
  return { objects: memory.ingest(result.objects) };
}

async function resolveLocator(page: Page, selector: string) {
  const normalizedSelector = normalizeRuntimeSelector(selector);
  if (normalizedSelector.startsWith("css=")) {
    return page.locator(normalizedSelector.slice("css=".length));
  }
  if (normalizedSelector.startsWith("text=")) {
    const text = normalizedSelector.slice("text=".length);
    const exact = page.getByText(text, { exact: true });
    if ((await exact.count()) === 1) {
      return exact;
    }
    return page.getByText(text);
  }
  return page.locator(normalizedSelector);
}

function assertNavigationAllowed(url: string, allowedNavigationUrls: string[], candidateRegistry: CandidateRegistry): void {
  if (allowedNavigationUrls.length === 0) {
    return;
  }
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    throw new Error(`Navigation URL must be absolute: ${url}`);
  }
  if (candidateRegistry.hasHref(normalizedUrl)) {
    return;
  }
  for (const allowed of allowedNavigationUrls) {
    const normalizedAllowed = normalizeUrl(allowed);
    if (normalizedAllowed && normalizedUrl === normalizedAllowed) {
      return;
    }
  }
  throw new Error(`Navigation URL "${url}" is not allowed unless it was explicitly provided by the task or observed in DOM.`);
}

function normalizeUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function normalizeRuntimeSelector(selector: string): string {
  const trimmed = selector.trim();
  if (/^ref=e\d+$/i.test(trimmed)) {
    throw new Error("ARIA snapshot refs like [ref=e123] are not runtime selectors; ask query_dom for a candidate selector.");
  }
  if (trimmed.startsWith("role=")) {
    return trimmed.replace(/\[ref=e\d+\]/gi, "");
  }
  return trimmed;
}

function readRequiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`Tool argument "${key}" must be a non-empty string`);
  }
  return field;
}

function readRequiredStringArray(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || field.length === 0 || field.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Tool argument "${key}" must be a non-empty array of strings`);
  }
  return field as string[];
}

// Strict tool schemas mark optional fields as nullable, so null means "not provided".
function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined || field === null) {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new Error(`Tool argument "${key}" must be a string`);
  }
  return field;
}

function readOptionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  if (field === undefined || field === null) {
    return undefined;
  }
  if (typeof field !== "number" || !Number.isFinite(field)) {
    throw new Error(`Tool argument "${key}" must be a finite number`);
  }
  return field;
}

function readOptionalBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key];
  if (field === undefined || field === null) {
    return undefined;
  }
  if (typeof field !== "boolean") {
    throw new Error(`Tool argument "${key}" must be a boolean`);
  }
  return field;
}
