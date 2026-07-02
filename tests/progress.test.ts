import { describe, expect, test } from "vitest";
import { ProgressTracker } from "../src/agent/progress.js";

describe("ProgressTracker", () => {
  test("detects repeated state and action fingerprints", () => {
    const tracker = new ProgressTracker({ maxNoProgress: 2 });

    expect(
      tracker.record({
        actionName: "click",
        actionArgs: { selector: "css=#missing" },
        url: "https://example.com",
        title: "Example",
      }),
    ).toEqual({ noProgress: false, repeatedCount: 1 });

    expect(
      tracker.record({
        actionName: "click",
        actionArgs: { selector: "css=#missing" },
        url: "https://example.com",
        title: "Example",
      }),
    ).toEqual({ noProgress: true, repeatedCount: 2 });
  });
});
