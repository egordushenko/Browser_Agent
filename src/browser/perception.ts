import type { Locator, Page } from "playwright";
import { CandidateRegistry, type CandidateRecord, toPublicCandidate } from "./candidate-registry.js";
import type { PagePerception } from "../types.js";

export interface PagePerceptionOptions {
  ariaSnapshotTimeoutMs: number;
  maxCandidateTextLength: number;
}

export interface PagePerceptionPage {
  evaluate: <T>(fn: (testElements?: RawCandidateElement[]) => T) => Promise<T>;
  locator: (selector: string) => Pick<Locator, "ariaSnapshot">;
}

export interface PagePerceptionWithRegistry {
  perception: PagePerception;
  registry: CandidateRegistry;
}

interface RawCandidateElement {
  ancestorSelector?: string | null;
  ariaLabel: string | null;
  cssPath?: string | null;
  href?: string | null;
  id: string;
  inDialog?: boolean;
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
  return (await collectPagePerceptionWithRegistry(page, options)).perception;
}

export async function collectPagePerceptionWithRegistry(
  page: PagePerceptionPage | Page,
  options: PagePerceptionOptions,
  previousRegistry?: CandidateRegistry,
): Promise<PagePerceptionWithRegistry> {
  const perceptionPage = page as PagePerceptionPage;
  const [ariaSnapshot, rawCandidates] = await Promise.all([
    perceptionPage.locator("body").ariaSnapshot({ mode: "ai", timeout: options.ariaSnapshotTimeoutMs }),
    collectRawCandidates(page),
  ]);

  const pageFingerprint = fingerprintPage(page, ariaSnapshot);
  const records = assignCandidateIds(
    dedupeCandidates(
      rawCandidates
        .map((candidate: RawCandidateElement) => toCandidateDraft(candidate, options, pageFingerprint))
        .filter(isDefined),
    ),
    pageFingerprint,
    previousRegistry,
  );

  return {
    perception: {
      ariaSnapshot,
      candidates: records.map(toPublicCandidate),
      ...(records.some((record) => record.inDialog) ? { dialogOpen: true } : {}),
    },
    registry: new CandidateRegistry(pageFingerprint, records),
  };
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

async function collectRawCandidates(page: PagePerceptionPage | Page): Promise<RawCandidateElement[]> {
  if (isBrowserPage(page)) {
    return (page as Page).evaluate(COLLECT_INTERACTIVE_ELEMENTS_SCRIPT);
  }
  return page.evaluate(collectInteractiveElements);
}

function isBrowserPage(page: PagePerceptionPage | Page): page is Page {
  return typeof (page as Partial<Page>).url === "function";
}

// Real Playwright pages evaluate this as a self-contained expression. Keeping all
// browser-context helpers inline avoids bundler-injected closure references such
// as "__name" leaking into Chrome.
const COLLECT_INTERACTIVE_ELEMENTS_SCRIPT = String.raw`(() => {
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
    "[data-test]"
  ].join(",");

  const attrSelector = (name, value) => "[" + name + "=\"" + String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"") + "\"]";

  const isInDialog = (element) =>
    Boolean(element.closest('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]'));

  const visible = Array.from(document.querySelectorAll(selector)).filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  });

  // Modal dialogs are portaled to the end of body; without this priority the
  // element cap can silently drop the only controls that are actually clickable.
  return visible
    .filter(isInDialog)
    .concat(visible.filter((element) => !isInDialog(element)))
    .slice(0, 120)
    .map((element) => {
      const findAncestorSelector = () => {
        let current = element.parentElement;
        while (current && current !== document.body && current !== document.documentElement) {
          if (current.id) {
            return attrSelector("id", current.id);
          }
          const testId = current.getAttribute("data-testid") || current.getAttribute("data-test");
          if (testId) {
            return attrSelector(current.hasAttribute("data-testid") ? "data-testid" : "data-test", testId);
          }
          current = current.parentElement;
        }
        return null;
      };

      // Positional path from the nearest stable ancestor. Unique by construction and
      // exactly as page-scoped as the candidateId that will reference it.
      const findCssPath = () => {
        const parts = [];
        let node = element;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node !== element && node.id) {
            parts.unshift(attrSelector("id", node.id));
            return parts.join(" > ");
          }
          const stableTestId = node !== element && node.getAttribute
            ? node.getAttribute("data-testid") || node.getAttribute("data-test")
            : null;
          if (stableTestId) {
            parts.unshift(attrSelector(node.hasAttribute("data-testid") ? "data-testid" : "data-test", stableTestId));
            return parts.join(" > ");
          }
          const parent = node.parentElement;
          if (!parent) {
            break;
          }
          const index = Array.prototype.indexOf.call(parent.children, node) + 1;
          parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + index + ")");
          node = parent;
        }
        parts.unshift("body");
        return parts.join(" > ");
      };

      return {
        cssPath: findCssPath(),
        ancestorSelector: findAncestorSelector(),
        ariaLabel: element.getAttribute("aria-label"),
        inDialog: isInDialog(element),
        href: element instanceof HTMLAnchorElement ? element.href : element.getAttribute("href"),
        id: element.id,
        name: element.getAttribute("name"),
        placeholder: element.getAttribute("placeholder"),
        role: element.getAttribute("role"),
        tagName: element.tagName,
        testId: element.getAttribute("data-testid") || element.getAttribute("data-test"),
        text: element.innerText || element.textContent || "",
        type: element.getAttribute("type")
      };
    });
})()`;

function collectInteractiveElements(testElements?: RawCandidateElement[]): RawCandidateElement[] {
  if (Array.isArray(testElements)) {
    return testElements;
  }
  return [];
}

function toCandidateDraft(
  raw: RawCandidateElement,
  options: PagePerceptionOptions,
  pageFingerprint: string,
): Omit<CandidateRecord, "candidateId"> | undefined {
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
    ...(raw.href?.trim() ? { href: raw.href.trim() } : {}),
    ...(raw.inDialog ? { inDialog: true } : {}),
    kind: inferCandidateKind(raw),
    label,
    nearestStableContainer: raw.ancestorSelector ?? null,
    pageFingerprint,
    ...(raw.role ? { role: raw.role } : {}),
    selector: selector.value,
    selectorSource: selector.selectorSource,
    tagName,
    text: raw.text,
  };
}

// Repeated controls (e.g. an apply button on every list card) produce identical
// internal selectors; collapse them and expose the count as ambiguity metadata.
function dedupeCandidates(candidates: Array<Omit<CandidateRecord, "candidateId">>): Array<Omit<CandidateRecord, "candidateId">> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.selector, (counts.get(candidate.selector) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const deduped: Array<Omit<CandidateRecord, "candidateId">> = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.selector)) {
      continue;
    }
    seen.add(candidate.selector);
    const occurrences = counts.get(candidate.selector) ?? 1;
    deduped.push(occurrences > 1 ? { ...candidate, occurrences } : candidate);
  }
  return deduped;
}

// Re-querying the same page must keep candidate ids stable: the orchestrator collects
// ids across several query_dom results and a reshuffle silently retargets its clicks.
function assignCandidateIds(
  candidates: Array<Omit<CandidateRecord, "candidateId">>,
  pageFingerprint: string,
  previousRegistry?: CandidateRegistry,
): CandidateRecord[] {
  const pageUrl = pageFingerprint.split("|")[0] ?? "";
  const samePage = previousRegistry !== undefined && previousRegistry.pageUrl === pageUrl;
  const reusableIds = new Map<string, string>(
    samePage ? previousRegistry.all().map((record) => [record.selector, record.candidateId]) : [],
  );

  const used = new Set<string>();
  let nextIndex = samePage ? maxCandidateIndex(previousRegistry) + 1 : 1;

  return candidates.map((candidate) => {
    const reused = reusableIds.get(candidate.selector);
    if (reused && !used.has(reused)) {
      used.add(reused);
      return { ...candidate, candidateId: reused };
    }
    while (used.has(`c${nextIndex}`)) {
      nextIndex += 1;
    }
    const candidateId = `c${nextIndex}`;
    nextIndex += 1;
    used.add(candidateId);
    return { ...candidate, candidateId };
  });
}

function maxCandidateIndex(registry: CandidateRegistry): number {
  let max = 0;
  for (const record of registry.all()) {
    const match = /^c(\d+)$/.exec(record.candidateId);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

function inferCandidateKind(raw: RawCandidateElement): CandidateRecord["kind"] {
  const tagName = raw.tagName.toLowerCase();
  const role = raw.role?.toLowerCase();
  if (tagName === "input" || tagName === "select" || tagName === "textarea") {
    return "input";
  }
  if (role === "button" || role === "tab" || tagName === "button") {
    return "button";
  }
  if (role === "link" || tagName === "a" || Boolean(raw.href)) {
    return "link";
  }
  return "control";
}

function chooseSelector(raw: RawCandidateElement): Pick<CandidateRecord, "selectorSource"> & { value: string } | null {
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
  // Elements without stable attributes (e.g. clickable cards) get a positional path:
  // role/text names are unreliable because the accessible name is the full card text.
  if (raw.cssPath) {
    return { selectorSource: "css-path", value: `css=${raw.cssPath}` };
  }
  if (raw.role) {
    const accessibleName = [raw.ariaLabel, raw.text]
      .find((value) => value && value.trim().length > 0)
      ?.trim()
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (accessibleName) {
      const roleSelector = `role=${raw.role}[name="${escapeAttributeValue(accessibleName)}"]`;
      return {
        selectorSource: "role",
        value: raw.ancestorSelector ? `css=${raw.ancestorSelector} >> ${roleSelector}` : roleSelector,
      };
    }
  }
  const firstTextLine = raw.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstTextLine) {
    return { selectorSource: "text", value: `text=${firstTextLine.slice(0, 80)}` };
  }
  return null;
}

function fingerprintPage(page: PagePerceptionPage | Page, ariaSnapshot: string): string {
  const url = typeof (page as Partial<Page>).url === "function" ? (page as Page).url() : "";
  return `${url}|${ariaSnapshot.slice(0, 512)}`;
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
