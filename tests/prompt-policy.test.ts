import { describe, expect, test } from "vitest";
import { ORCHESTRATOR_SYSTEM_PROMPT, SECURITY_CLASSIFIER_SYSTEM_PROMPT } from "../src/agent/prompts.js";

describe("runtime prompt policy", () => {
  test("does not contain hardcoded UI label or URL-pattern hints", () => {
    const runtimePrompts = [ORCHESTRATOR_SYSTEM_PROMPT, SECURITY_CLASSIFIER_SYSTEM_PROMPT].join("\n");
    // These strings are regression guards only; runtime prompts must stay free of UI/text-flow hints.
    const forbiddenHints = [
      "add cover letter",
      "cover letter",
      "personalized message",
      "mark spam",
      "add to cart",
      "apply to N",
      "delete N",
      "auto-generate buttons",
      "study the resume first",
      "items to a cart",
      "Добавить сопроводительное",
      "OK",
      "Got it",
      "Отлично",
      "Закрыть",
      "Понятно",
      "application-response",
    ];

    for (const hint of forbiddenHints) {
      expect(runtimePrompts, `forbidden runtime prompt hint: ${hint}`).not.toContain(hint);
    }
  });
});
