import { describe, expect, test } from "vitest";
import { formatForLog } from "../src/terminal-format.js";

describe("formatForLog", () => {
  test("strips ANSI styling so Playwright errors cannot leak dim text into later logs", () => {
    expect(formatForLog("\u001B[2mCall log:\n  - waiting\u001B[0m")).toBe("Call log:\n  - waiting");
  });
});
