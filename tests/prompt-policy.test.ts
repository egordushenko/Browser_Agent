import { describe, expect, test } from "vitest";
import { ORCHESTRATOR_SYSTEM_PROMPT, SECURITY_CLASSIFIER_SYSTEM_PROMPT } from "../src/agent/prompts.js";

describe("runtime prompt policy", () => {
  test("does not contain hardcoded UI label or URL-pattern hints", () => {
    const runtimePrompts = [ORCHESTRATOR_SYSTEM_PROMPT, SECURITY_CLASSIFIER_SYSTEM_PROMPT].join("\n");
    const forbiddenHints = [
      "add cover letter",
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
