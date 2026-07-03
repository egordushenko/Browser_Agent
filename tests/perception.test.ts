import { describe, expect, test } from "vitest";
import { collectPagePerception, collectPagePerceptionWithRegistry, truncateText } from "../src/browser/perception.js";
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

    // Snapshot refs are stripped: they are not resolvable ids and only tempt the sub-agent.
    expect(perception.ariaSnapshot).toBe('- textbox "Search"');
    expect(perception.candidates).toEqual([
      {
        candidateId: "c1",
        kind: "input",
        label: "Search",
        tagName: "input",
        text: "",
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

    expect(perception.candidates[0]).toMatchObject({
      candidateId: "c1",
      label: "Постоянная работа, подработка\nAI-first Product Engineer · Full-Stack\n80 000 ₽",
      text: "  \nПостоянная работа, подработка\nAI-first Product Engineer · Full-Stack\n80 000 ₽",
    });
    expect(JSON.stringify(perception.candidates[0])).not.toContain("selector");
  });

  test("keeps candidate ids stable when the same page is re-queried", async () => {
    const rawElement = (id: string, text: string) => ({
      tagName: "BUTTON",
      id,
      text,
      role: null,
      ariaLabel: null,
      testId: null,
      name: null,
      placeholder: null,
      type: null,
    });
    const makePage = (elements: ReturnType<typeof rawElement>[]): PagePerceptionPage => ({
      locator: () => ({ ariaSnapshot: async () => "-" }),
      evaluate: async (fn) => fn(elements),
    });
    const options = { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 40 };

    const first = await collectPagePerceptionWithRegistry(makePage([rawElement("apply-1", "Apply 1"), rawElement("apply-2", "Apply 2")]), options);
    expect(first.perception.candidates.map((candidate) => candidate.candidateId)).toEqual(["c1", "c2"]);

    // Re-render: apply-1 disappeared, a new button appeared; apply-2 must keep its id.
    const second = await collectPagePerceptionWithRegistry(
      makePage([rawElement("apply-2", "Apply 2"), rawElement("apply-3", "Apply 3")]),
      options,
      first.registry,
    );

    const byId = Object.fromEntries(second.perception.candidates.map((candidate) => [candidate.label, candidate.candidateId]));
    expect(byId["Apply 2"]).toBe("c2");
    expect(byId["Apply 3"]).toBe("c3");
  });

  test("collapses repeated identical selectors into one candidate with an occurrences count", async () => {
    const applyButton = {
      tagName: "BUTTON",
      id: "",
      text: "Откликнуться",
      role: null,
      ariaLabel: null,
      testId: null,
      name: null,
      placeholder: null,
      type: null,
    };
    const page: PagePerceptionPage = {
      locator: () => ({
        ariaSnapshot: async () => "-",
      }),
      evaluate: async (fn) => fn([applyButton, { ...applyButton }, { ...applyButton }]),
    };

    const perception = await collectPagePerception(page, { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 40 });

    expect(perception.candidates).toEqual([
      {
        label: "Откликнуться",
        occurrences: 3,
        candidateId: "c1",
        kind: "button",
        tagName: "button",
        text: "Откликнуться",
      },
    ]);
  });

  test("scopes repeated controls to the nearest stable ancestor when available", async () => {
    const page: PagePerceptionPage = {
      locator: () => ({
        ariaSnapshot: async () => "-",
      }),
      evaluate: async (fn) =>
        fn([
          {
            tagName: "A",
            id: "",
            text: "Apply",
            role: "button",
            ariaLabel: null,
            testId: null,
            name: null,
            placeholder: null,
            type: null,
            ancestorSelector: "#job-1",
          },
          {
            tagName: "A",
            id: "",
            text: "Apply",
            role: "button",
            ariaLabel: null,
            testId: null,
            name: null,
            placeholder: null,
            type: null,
            ancestorSelector: "#job-2",
          },
        ]),
    };

    const perception = await collectPagePerception(page, { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 40 });

    expect(perception.candidates).toEqual([
      {
        label: "Apply",
        candidateId: "c1",
        kind: "button",
        role: "button",
        tagName: "a",
        text: "Apply",
      },
      {
        label: "Apply",
        candidateId: "c2",
        kind: "button",
        role: "button",
        tagName: "a",
        text: "Apply",
      },
    ]);
  });

  test("prefers role selectors for controls whose text is not unique enough", async () => {
    const page: PagePerceptionPage = {
      locator: () => ({
        ariaSnapshot: async () => '- tab "Resume" [ref=e2]',
      }),
      evaluate: async (fn) =>
        fn([
          {
            tagName: "BUTTON",
            id: "",
            text: "Resume",
            role: "tab",
            ariaLabel: null,
            testId: null,
            name: null,
            placeholder: null,
            type: null,
          },
        ]),
    };

    const perception = await collectPagePerception(page, { ariaSnapshotTimeoutMs: 5000, maxCandidateTextLength: 40 });

    expect(perception.candidates).toEqual([
      {
        label: "Resume",
        candidateId: "c1",
        kind: "button",
        role: "tab",
        tagName: "button",
        text: "Resume",
      },
    ]);
  });
});
