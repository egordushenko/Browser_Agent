import { describe, expect, test } from "vitest";
import { formatTaskAcceptedLog, normalizeTaskInput } from "../src/repl.js";

describe("normalizeTaskInput", () => {
  test("trims a natural-language task", () => {
    expect(normalizeTaskInput("  open a page  ")).toEqual({ kind: "task", task: "open a page" });
  });

  test("maps blank input and exit commands to control results", () => {
    expect(normalizeTaskInput("   ")).toEqual({ kind: "empty" });
    expect(normalizeTaskInput("exit")).toEqual({ kind: "exit" });
    expect(normalizeTaskInput(" quit ")).toEqual({ kind: "exit" });
  });
});

describe("formatTaskAcceptedLog", () => {
  test("prints the task in a stable log format", () => {
    expect(formatTaskAcceptedLog("open a page")).toBe('Task accepted: "open a page"');
  });
});
