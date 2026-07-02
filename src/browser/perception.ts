import type { Locator, Page } from "playwright";
import type { PagePerception, PerceptionCandidate } from "../types.js";

export interface PagePerceptionOptions {
  ariaSnapshotTimeoutMs: number;
  maxCandidateTextLength: number;
}

export interface PagePerceptionPage {
  evaluate: <T>(fn: (testElements?: RawCandidateElement[]) => T) => Promise<T>;
  locator: (selector: string) => Pick<Locator, "ariaSnapshot">;
}

interface RawCandidateElement {
  ariaLabel: string | null;
  id: string;
  name: string | null;
  placeholder: string | null;
  role: string | null;
  tagName: string;
  testId: string | null;
  text: string;
  type: string | null;
}

export async function collectPagePerception(
  page: PagePerceptionPage | Page,
  options: PagePerceptionOptions,
): Promise<PagePerception> {
  const perceptionPage = page as PagePerceptionPage;
  const [ariaSnapshot, rawCandidates] = await Promise.all([
    perceptionPage.locator("body").ariaSnapshot({ mode: "ai", timeout: options.ariaSnapshotTimeoutMs }),
    perceptionPage.evaluate(collectInteractiveElements),
  ]);

  return {
    ariaSnapshot,
    candidates: rawCandidates
      .map((candidate: RawCandidateElement) => toPerceptionCandidate(candidate, options))
      .filter(isDefined),
  };
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function collectInteractiveElements(testElements?: RawCandidateElement[]): RawCandidateElement[] {
  if (Array.isArray(testElements)) {
    return testElements;
  }

  const selector = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "[role]",
    "[tabindex]",
    "[contenteditable='true']",
    "[data-testid]",
    "[data-test]",
  ].join(",");

  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    })
    .slice(0, 120)
    .map((element) => ({
      ariaLabel: element.getAttribute("aria-label"),
      id: element.id,
      name: element.getAttribute("name"),
      placeholder: element.getAttribute("placeholder"),
      role: element.getAttribute("role"),
      tagName: element.tagName,
      testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test"),
      text: element.innerText ?? element.textContent ?? "",
      type: element.getAttribute("type"),
    }));
}

function toPerceptionCandidate(
  raw: RawCandidateElement,
  options: PagePerceptionOptions,
): PerceptionCandidate | undefined {
  const tagName = raw.tagName.toLowerCase();
  const label = truncateText(
    [raw.ariaLabel, raw.placeholder, raw.name, raw.text].find((value) => value && value.trim())?.trim() ??
      `${tagName}${raw.type ? `:${raw.type}` : ""}`,
    options.maxCandidateTextLength,
  );

  const selector = chooseSelector(raw);
  if (!selector) {
    return undefined;
  }

    return {
    label,
    selector: selector.value,
    selectorSource: selector.selectorSource,
    tagName,
  };
}

function chooseSelector(raw: RawCandidateElement): Pick<PerceptionCandidate, "selectorSource"> & { value: string } | null {
  if (raw.id) {
    return { selectorSource: "id", value: `css=${cssIdSelector(raw.id)}` };
  }
  if (raw.testId) {
    return { selectorSource: "data-testid", value: `css=[data-testid="${escapeAttributeValue(raw.testId)}"]` };
  }
  if (raw.name) {
    return { selectorSource: "name", value: `css=[name="${escapeAttributeValue(raw.name)}"]` };
  }
  if (raw.ariaLabel) {
    return { selectorSource: "aria-label", value: `css=[aria-label="${escapeAttributeValue(raw.ariaLabel)}"]` };
  }
  const firstTextLine = raw.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstTextLine) {
    // Playwright text= does substring matching, so a single short line is far more
    // robust than the element's full multiline innerText.
    return { selectorSource: "text", value: `text=${firstTextLine.slice(0, 80)}` };
  }
  return null;
}

function cssIdSelector(id: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
    return `#${id}`;
  }
  return `[id="${escapeAttributeValue(id)}"]`;
}

function escapeAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
