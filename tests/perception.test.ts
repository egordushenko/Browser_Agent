import { describe, expect, test } from "vitest";
import { collectPagePerception, truncateText } from "../src/browser/perception.js";
import type { PagePerceptionPage } from "../src/browser/perception.js";

describe("truncateText", () => {
  test("keeps compact page text within the configured character limit", () => {
    expect(truncateText("abcdef", 4)).toBe("abcd...");
    expect(truncateText("abc", 4)).toBe("abc");
  });
});

describe("collectPagePerception", () => {
  test("collects an AI aria snapshot and compact interactive candidates", async () => {
    const page: PagePerceptionPage = {
      locator: (selector) => {
        expect(selector).toBe("body");
        return {
          ariaSnapshot: async (options) => {
            expect(options).toEqual({ mode: "ai", timeout: 5000 });
            return '- textbox "Search" [ref=e2]';
          },
        };
      },
      evaluate: async (fn) =>
        fn([
          {
            tagName: "INPUT",
            id: "search",
            text: "",
            role: null,
            ariaLabel: "Search",
            testId: null,
            name: "q",
            placeholder: "Search",
            type: "text",
          },
        ]),
    };

    const perception = await collectPagePerception(page, { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 40 });

    expect(perception.ariaSnapshot).toBe('- textbox "Search" [ref=e2]');
    expect(perception.candidates).toEqual([
      {
        label: "Search",
        selector: "css=#search",
        selectorSource: "id",
        tagName: "input",
      },
    ]);
  });

  test("text selectors use one short line instead of the full multiline innerText", async () => {
    const page: PagePerceptionPage = {
      locator: () => ({
        ariaSnapshot: async () => "-",
      }),
      evaluate: async (fn) =>
        fn([
          {
            tagName: "A",
            id: "",
            text: "  \nПостоянная работа, подработка\nAI-first Product Engineer · Full-Stack\n80 000 ₽",
            role: null,
            ariaLabel: null,
            testId: null,
            name: null,
            placeholder: null,
            type: null,
          },
        ]),
    };

    const perception = await collectPagePerception(page, { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 200 });

    expect(perception.candidates[0].selector).toBe("text=Постоянная работа, подработка");
    expect(perception.candidates[0].selector).not.toContain("\n");
  });
});
