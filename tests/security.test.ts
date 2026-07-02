import { describe, expect, test } from "vitest";
import { parseSecurityDecision, SecurityGate } from "../src/agent/security.js";
import type { LLMProvider } from "../src/llm/provider.js";

describe("parseSecurityDecision", () => {
  test("reads fenced classifier JSON", () => {
    expect(parseSecurityDecision('```json\n{"requiresConfirmation": false, "reason": "Safe."}\n```')).toEqual({
      requiresConfirmation: false,
      reason: "Safe.",
    });
  });

  test("fails closed on garbage", () => {
    expect(parseSecurityDecision("no verdict here").requiresConfirmation).toBe(true);
    expect(parseSecurityDecision(undefined).requiresConfirmation).toBe(true);
  });
});

describe("SecurityGate", () => {
  test("asks for confirmation when classifier marks an action irreversible", async () => {
    const provider: LLMProvider = {
      complete: async (request) => {
        expect(request.messages[0].content).toContain("click");
        return {
          text: JSON.stringify({
            requiresConfirmation: true,
            reason: "This action appears to submit a purchase.",
          }),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    };
    const confirmations: string[] = [];
    const gate = new SecurityGate({
      confirm: async (message) => {
        confirmations.push(message);
        return false;
      },
      provider,
    });

    const result = await gate.review({
      arguments: { candidateId: "c-checkout" },
      task: "Add item to cart, do not pay",
      toolName: "click",
    });

    expect(result).toEqual({
      allowed: false,
      reason: "This action appears to submit a purchase.",
    });
    expect(confirmations[0]).toContain("This action appears to submit a purchase.");
  });

  test("allows reversible actions without asking the user", async () => {
    const provider: LLMProvider = {
      complete: async () => ({
        text: JSON.stringify({ requiresConfirmation: false, reason: "Typing into a search box is reversible." }),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    };
    let confirmCalled = false;
    const gate = new SecurityGate({
      confirm: async () => {
        confirmCalled = true;
        return true;
      },
      provider,
    });

    const result = await gate.review({
      arguments: { candidateId: "c-search", text: "hot dog" },
      task: "Find a hot dog",
      toolName: "type",
    });

    expect(result.allowed).toBe(true);
    expect(confirmCalled).toBe(false);
  });

  test("allows a gated action after explicit user confirmation", async () => {
    const provider: LLMProvider = {
      complete: async () => ({
        text: JSON.stringify({ requiresConfirmation: true, reason: "This confirms an order." }),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    };
    const gate = new SecurityGate({
      confirm: async () => true,
      provider,
    });

    const result = await gate.review({
      arguments: { candidateId: "c-confirm" },
      task: "Confirm my order",
      toolName: "click",
    });

    expect(result).toEqual({ allowed: true, reason: "This confirms an order." });
  });

  test("fails closed when the classifier answer is not parseable", async () => {
    const provider: LLMProvider = {
      complete: async () => ({
        text: "not json at all",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    };
    const confirmations: string[] = [];
    const gate = new SecurityGate({
      confirm: async (message) => {
        confirmations.push(message);
        return false;
      },
      provider,
    });

    const result = await gate.review({
      arguments: { candidateId: "c-anything" },
      task: "Do something",
      toolName: "click",
    });

    expect(result.allowed).toBe(false);
    expect(confirmations).toHaveLength(1);
  });
});
