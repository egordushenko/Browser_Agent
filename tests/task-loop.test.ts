import { describe, expect, test } from "vitest";
import { runAgentTask } from "../src/agent/orchestrator.js";
import { SecurityGate } from "../src/agent/security.js";
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
            toolCall: { id: "call-1", name: "click", arguments: { candidateId: "c99" } },
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
        throw new Error("candidate not found");
      },
      openCandidate: async () => {
        throw new Error("candidate not found");
      },
      navigate: async (url) => ({ url, title: "Example" }),
      queryDom: async () => ({
        answer: "Use c1",
        candidates: [{ candidateId: "c1", kind: "input", label: "Search", tagName: "input", text: "" }],
        confidence: "high",
      }),
      readPage: async () => ({ answer: "Page", confidence: "medium" }),
      askUser: async (question) => ({ question }),
      done: async (summary) => ({ summary }),
      scroll: async (direction, amount) => ({ direction, amount }),
      type: async (candidateId, text) => ({ candidateId, textLength: text.length }),
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
      task: "Recover from a stale candidate id",
    });

    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolResult).toMatchObject({ ok: false, content: "candidate not found" });
    expect(result.steps[1].toolResult).toMatchObject({ ok: true, toolName: "query_dom" });
    expect(providerCalls[1]).toContain("candidate not found");
  });

  test("stops when the model calls done", async () => {
    const provider: LLMProvider = {
      complete: async () => ({
        toolCall: { id: "done-1", name: "done", arguments: { summary: "Added item to cart." } },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    };
    const runtime: BrowserToolRuntime = {
      askUser: async (question) => ({ question }),
      click: async (candidateId) => ({ candidateId }),
      openCandidate: async (candidateId) => ({ candidateId }),
      done: async (summary) => ({ summary }),
      navigate: async (url) => ({ url, title: "Example" }),
      queryDom: async () => ({
        answer: "Use c1",
        candidates: [{ candidateId: "c1", kind: "input", label: "Search", tagName: "input", text: "" }],
        confidence: "high",
      }),
      readPage: async () => ({ answer: "Page", confidence: "medium" }),
      scroll: async (direction, amount) => ({ direction, amount }),
      type: async (candidateId, text) => ({ candidateId, textLength: text.length }),
      wait: async (seconds) => ({ seconds }),
    };

    const result = await runAgentTask({
      limits: {
        maxConsecutiveErrors: 3,
        maxNoProgress: 3,
        maxSteps: 5,
        stepTimeoutMs: 1000,
      },
      observe: async () => ({ url: "https://example.com", title: "Example", lastToolResult: null }),
      provider,
      runtime,
      task: "Add item to cart",
    });

    expect(result.stopReason).toBe("done");
    expect(result.steps).toHaveLength(1);
  });

  test("gates open_candidate and hands the classifier the target element metadata", async () => {
    const classifierInputs: string[] = [];
    const opened: string[] = [];
    const provider: LLMProvider = {
      complete: async (request) => {
        const transcript = request.messages.map((message) => message.content).join("\n");
        if (!transcript.includes("Blocked by security gate")) {
          return {
            toolCall: { id: "call-1", name: "open_candidate", arguments: { candidateId: "c81" } },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return {
          toolCall: {
            id: "call-2",
            name: "done",
            arguments: { summary: "Application stopped by the user.", incomplete_reason: null },
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };
    const runtime: BrowserToolRuntime = {
      askUser: async (question) => ({ question }),
      click: async (candidateId) => ({ candidateId }),
      describeCandidate: () => ({
        href: "https://hh.ru/applicant/vacancy_response?vacancyId=1",
        kind: "link",
        label: "Откликнуться",
      }),
      done: async (summary) => ({ summary }),
      navigate: async (url) => ({ url, title: "Example" }),
      openCandidate: async (candidateId) => {
        opened.push(candidateId);
        return { candidateId };
      },
      queryDom: async () => ({ answer: "-", confidence: "medium" }),
      readPage: async () => ({ answer: "-", confidence: "medium" }),
      scroll: async (direction, amount) => ({ direction, amount }),
      type: async (candidateId, text) => ({ candidateId, textLength: text.length }),
      wait: async (seconds) => ({ seconds }),
    };
    const securityGate = new SecurityGate({
      confirm: async () => false,
      provider: {
        complete: async (request) => {
          classifierInputs.push(request.messages[0].content);
          return {
            text: JSON.stringify({ requiresConfirmation: true, reason: "Opens a job application form." }),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        },
      },
    });

    const result = await runAgentTask({
      limits: { maxConsecutiveErrors: 3, maxNoProgress: 3, maxSteps: 5, stepTimeoutMs: 1000 },
      observe: async () => ({ url: "https://hh.ru/search", title: "Search", lastToolResult: null }),
      provider,
      runtime,
      securityGate,
      task: "Apply to vacancies",
    });

    expect(opened).toEqual([]);
    expect(result.stopReason).toBe("done");
    expect(classifierInputs[0]).toContain("Откликнуться");
    expect(classifierInputs[0]).toContain("vacancy_response");
  });

  test("blocks a gated click when the user declines and lets the model finish with done", async () => {
    const clicked: string[] = [];
    const provider: LLMProvider = {
      complete: async (request) => {
        const transcript = request.messages.map((message) => message.content).join("\n");
        if (!transcript.includes("Blocked by security gate")) {
          return {
            toolCall: { id: "call-1", name: "click", arguments: { candidateId: "c-pay-now" } },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }
        return {
          toolCall: {
            id: "call-2",
            name: "done",
            arguments: { summary: "Reached checkout; payment stopped by the user." },
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };
    const runtime: BrowserToolRuntime = {
      askUser: async (question) => ({ question }),
      click: async (candidateId) => {
        clicked.push(candidateId);
        return { candidateId };
      },
      openCandidate: async (candidateId) => ({ candidateId }),
      done: async (summary) => ({ summary }),
      navigate: async (url) => ({ url, title: "Example" }),
      queryDom: async () => ({
        answer: "Use c1",
        candidates: [{ candidateId: "c1", kind: "input", label: "Search", tagName: "input", text: "" }],
        confidence: "high",
      }),
      readPage: async () => ({ answer: "Page", confidence: "medium" }),
      scroll: async (direction, amount) => ({ direction, amount }),
      type: async (candidateId, text) => ({ candidateId, textLength: text.length }),
      wait: async (seconds) => ({ seconds }),
    };
    const securityGate = new SecurityGate({
      confirm: async () => false,
      provider: {
        complete: async () => ({
          text: JSON.stringify({ requiresConfirmation: true, reason: "This click starts a payment." }),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      },
    });

    const result = await runAgentTask({
      limits: {
        maxConsecutiveErrors: 3,
        maxNoProgress: 3,
        maxSteps: 5,
        stepTimeoutMs: 1000,
      },
      observe: async () => ({ url: "https://example.com/cart", title: "Cart", lastToolResult: null }),
      provider,
      runtime,
      securityGate,
      task: "Add item to cart, do not pay",
    });

    expect(clicked).toEqual([]);
    expect(result.stopReason).toBe("done");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolResult).toMatchObject({ ok: false, toolName: "click" });
  });
});
