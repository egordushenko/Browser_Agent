import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { ObjectMemory } from "../src/agent/object-memory.js";
import { createBrowserToolRuntime, executeToolCall } from "../src/agent/tools.js";
import { collectPagePerception } from "../src/browser/perception.js";
import type { DomAgent } from "../src/subagents/dom-agent.js";

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
  <head><title>Fixture Shop</title></head>
  <body>
    <input id="search" placeholder="Search products" />
    <button data-testid="search-submit">Search</button>
    <button role="tab" aria-selected="false" id="resume-tab">Resume</button>
    <button>Create Resume</button>
    <p>Found 12 matching jobs for resume</p>
    <ul>
      <li>Classic hot dog <button aria-label="Add classic hot dog to cart">Add</button></li>
    </ul>
    <section id="job-1">
      <a href="#job-1-detail">Junior Python Engineer</a>
      <a tabindex="0" role="button" href="#apply-job-1">Apply</a>
    </section>
    <section id="job-2">
      <a href="#job-2-detail">AI Engineer</a>
      <a tabindex="0" role="button" href="#apply-job-2">Apply</a>
    </section>
    <button id="vanishing">Vanishing button</button>
    <output id="active-tab">jobs</output>
    <output id="cart-count">0</output>
    <script>
      document.getElementById("resume-tab").addEventListener("click", () => {
        document.getElementById("active-tab").textContent = "resume";
      });
      document.querySelector('[aria-label="Add classic hot dog to cart"]').addEventListener("click", () => {
        const cart = document.getElementById("cart-count");
        cart.textContent = String(Number(cart.textContent) + 1);
      });
      document.getElementById("vanishing").addEventListener("click", (event) => {
        event.target.remove();
      });
    </script>
  </body>
</html>`;

let browser: Browser | null = null;
let page: Page;

beforeAll(async () => {
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    browser = null; // Chrome is unavailable in this environment; tests below self-skip.
    return;
  }
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("browser smoke on a local fixture", () => {
  test("perception yields stable runtime selectors for interactive elements", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);

    const perception = await collectPagePerception(page, {
      ariaSnapshotTimeoutMs: 5000,
      maxCandidateTextLength: 120,
    });

    expect(perception.ariaSnapshot).toContain("Search products");
    expect(perception.candidates.map((candidate) => candidate.candidateId)).toEqual(
      perception.candidates.map((_, index) => `c${index + 1}`),
    );
    expect(perception.candidates.some((candidate) => candidate.label === "Search products")).toBe(true);
    expect(perception.candidates.some((candidate) => candidate.label === "Search")).toBe(true);
    expect(JSON.stringify(perception.candidates)).not.toContain("selector");
  }, 30_000);

  test("click and type work through candidate ids and mutate the page", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);

    const typed = await executeToolCall(
      { id: "t", name: "type", arguments: { candidateId: "c1", text: "hot dog" } },
      runtime,
    );
    expect(typed.ok).toBe(true);
    expect(await page.inputValue("#search")).toBe("hot dog");

    const clicked = await executeToolCall(
      { id: "c", name: "click", arguments: { candidateId: "c5" } },
      runtime,
    );
    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#cart-count")).toBe("1");
  }, 30_000);

  test("candidate ids click the intended role control when text is ambiguous", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);

    const clicked = await executeToolCall(
      { id: "tab", name: "click", arguments: { candidateId: "c3" } },
      runtime,
    );

    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#active-tab")).toBe("resume");
  }, 30_000);

  test("candidate ids click a repeated control inside a specific card", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);

    const clicked = await executeToolCall(
      { id: "apply-2", name: "click", arguments: { candidateId: "c9" } },
      runtime,
    );

    expect(clicked.ok).toBe(true);
    expect(page.url()).toContain("#apply-job-2");
  }, 30_000);

  test("legacy selector arguments are rejected before Playwright sees them", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const clicked = await executeToolCall(
      { id: "tab-ref", name: "click", arguments: { selector: 'role=tab[name="Resume"][ref=e123]' } },
      runtime,
    );

    expect(clicked.ok).toBe(false);
    expect(String(clicked.content)).toContain('Tool argument "candidateId"');
  }, 30_000);

  test("guessed internal navigation is blocked when the task only allowed the site root", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page, undefined, {
      allowedNavigationUrls: ["https://hh.ru/"],
    });

    const result = await executeToolCall(
      { id: "nav", name: "navigate", arguments: { url: "https://hh.ru/account/resumes" } },
      runtime,
    );

    expect(result.ok).toBe(false);
    expect(String(result.content)).toContain("not allowed unless it was explicitly provided by the task or observed in DOM");
    expect(page.url()).not.toContain("hh.ru/account/resumes");
  }, 30_000);

  test("open_candidate opens a link candidate by id", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);

    const opened = await executeToolCall(
      { id: "open-job", name: "open_candidate", arguments: { candidateId: "c6" } },
      runtime,
    );

    expect(opened.ok).toBe(true);
    expect(page.url()).toContain("#job-1-detail");
  }, 30_000);

  test("a stale selector surfaces as a recoverable tool error", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    page.setDefaultTimeout(1_000);

    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);
    const first = await executeToolCall({ id: "v1", name: "click", arguments: { candidateId: "c10" } }, runtime);
    expect(first.ok).toBe(true);

    const second = await executeToolCall(
      { id: "v2", name: "click", arguments: { candidateId: "c10" } },
      runtime,
    );
    expect(second.ok).toBe(false);
    expect(String(second.content)).toContain("Timeout");
  }, 30_000);

  test("query_dom ingests extracted objects into memory and click marks them opened", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const objectMemory = new ObjectMemory();
    const domAgentStub = {
      query: async () => ({
        answer: "Two vacancies visible.",
        confidence: "high" as const,
        objects: [
          { type: "vacancy" as const, title: "Junior Python Engineer", fields: { section: "job-1" }, candidateId: "c6" },
          { type: "vacancy" as const, title: "AI Engineer", fields: { section: "job-2" }, candidateId: "c8" },
        ],
      }),
    } as unknown as DomAgent;
    const runtime = createBrowserToolRuntime(page, domAgentStub, { objectMemory });

    const queried = await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "list vacancies" } }, runtime);
    expect(queried.ok).toBe(true);
    const content = queried.content as { objects?: Array<{ objectId: string; status: string }> };
    expect(content.objects?.map((object) => [object.objectId, object.status])).toEqual([
      ["o1", "seen"],
      ["o2", "seen"],
    ]);

    const opened = await executeToolCall({ id: "open", name: "open_candidate", arguments: { candidateId: "c6" } }, runtime);
    expect(opened.ok).toBe(true);
    expect(objectMemory.get("o1").status).toBe("opened");
    expect(objectMemory.get("o2").status).toBe("seen");
  }, 30_000);

  test("scroll and wait run without touching the DOM", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const scrolled = await executeToolCall(
      { id: "s", name: "scroll", arguments: { direction: "down", amount: 200 } },
      runtime,
    );
    expect(scrolled).toMatchObject({ ok: true, content: { direction: "down", amount: 200 } });

    const waited = await executeToolCall({ id: "w", name: "wait", arguments: { seconds: 0.1 } }, runtime);
    expect(waited).toMatchObject({ ok: true, content: { seconds: 0.1 } });
  }, 30_000);
});
