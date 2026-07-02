import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { ObjectMemory } from "../src/agent/object-memory.js";
import { createBrowserToolRuntime, executeToolCall } from "../src/agent/tools.js";
import { collectPagePerception } from "../src/browser/perception.js";
import { trackActivePage } from "../src/browser/session.js";
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
    <section id="resumes">
      <div role="button" tabindex="0" class="resume-card">
        Постоянная работа, подработка<br />
        AI-first Product Engineer · Full-Stack<br />
        80 000 ₽ · Удалённо, Гибрид
      </div>
    </section>
    <a href="about:blank#newtab" target="_blank" id="open-new-tab">Open in new tab</a>
    <output id="active-tab">jobs</output>
    <output id="cart-count">0</output>
    <output id="opened-resume">none</output>
    <script>
      document.querySelector("#resumes .resume-card").addEventListener("click", () => {
        document.getElementById("opened-resume").textContent = "ai-first";
      });
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

  test("clickable cards without stable attributes get a positional path (hh resume-card pattern)", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const queried = await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect candidates" } }, runtime);
    const candidates = (queried.content as { candidates: Array<{ candidateId: string; label: string }> }).candidates;
    const card = candidates.find((candidate) => candidate.label.startsWith("Постоянная работа"));
    expect(card).toBeDefined();

    const clicked = await executeToolCall(
      { id: "card", name: "click", arguments: { candidateId: card!.candidateId } },
      runtime,
    );

    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#opened-resume")).toBe("ai-first");
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

  test("full batch flow: extract, open, propose, confirm, execute by objectId", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const objectMemory = new ObjectMemory();
    const domAgentStub = {
      query: async () => ({
        answer: "Two vacancies with apply controls.",
        confidence: "high" as const,
        objects: [
          {
            type: "vacancy" as const,
            title: "Junior Python Engineer",
            candidateId: "c6",
            actionCandidateId: "c7",
            fields: { keywords: "Python, Junior" },
          },
          {
            type: "vacancy" as const,
            title: "AI Engineer",
            candidateId: "c8",
            actionCandidateId: "c9",
            fields: { keywords: "AI" },
          },
        ],
      }),
    } as unknown as DomAgent;
    const confirmations: string[] = [];
    const runtime = createBrowserToolRuntime(page, domAgentStub, {
      askUser: async (question) => {
        confirmations.push(question);
        return "y";
      },
      objectMemory,
    });

    await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "list vacancies" } }, runtime);

    // done is blocked until the review/confirm workflow is respected end to end.
    await executeToolCall({ id: "o1", name: "open_candidate", arguments: { candidateId: "c6" } }, runtime);
    await executeToolCall({ id: "o2", name: "open_candidate", arguments: { candidateId: "c8" } }, runtime);

    const proposed = await executeToolCall(
      {
        id: "p",
        name: "propose_selection",
        arguments: { objectType: "vacancy", objectIds: ["o1", "o2"], reason: "Python/AI match" },
      },
      runtime,
    );
    expect(proposed.ok).toBe(true);

    const blockedDone = await executeToolCall(
      { id: "d1", name: "done", arguments: { summary: "done early", incomplete_reason: null } },
      runtime,
    );
    expect(blockedDone.ok).toBe(false);
    expect(String(blockedDone.content)).toContain("confirmation_required");

    const confirmed = await executeToolCall(
      { id: "c", name: "confirm_batch", arguments: { summary: "Откликнуться на 2 вакансии" } },
      runtime,
    );
    expect(confirmed.content).toMatchObject({ confirmed: true });
    expect(confirmations[0]).toContain("Откликнуться на 2 вакансии");

    const executed = await executeToolCall(
      { id: "e", name: "execute_batch", arguments: { action: "apply", objectIds: ["o1", "o2"] } },
      runtime,
    );
    expect(executed.ok).toBe(true);
    expect(executed.content).toEqual({
      action: "apply",
      results: [
        { objectId: "o1", outcome: "action_done" },
        { objectId: "o2", outcome: "action_done" },
      ],
    });
    expect(page.url()).toContain("#apply-job-2");

    const finished = await executeToolCall(
      { id: "d2", name: "done", arguments: { summary: "Applied to both vacancies", incomplete_reason: null } },
      runtime,
    );
    expect(finished.ok).toBe(true);
  }, 30_000);

  test("a link opening a new tab moves the agent to that tab", async (ctx) => {
    if (!browser) return ctx.skip();
    const tabPage = await browser.newPage();
    try {
      await tabPage.setContent(FIXTURE_HTML);
      const activePage = trackActivePage(tabPage.context(), tabPage);
      const runtime = createBrowserToolRuntime(() => activePage());

      const queried = await executeToolCall(
        { id: "q", name: "query_dom", arguments: { question: "collect candidates" } },
        runtime,
      );
      const candidates = (queried.content as { candidates: Array<{ candidateId: string; label: string }> }).candidates;
      const newTabLink = candidates.find((candidate) => candidate.label === "Open in new tab");
      expect(newTabLink).toBeDefined();

      const clicked = await executeToolCall(
        { id: "c", name: "click", arguments: { candidateId: newTabLink!.candidateId } },
        runtime,
      );
      expect(clicked.ok).toBe(true);

      await expect.poll(() => activePage().url(), { timeout: 5000 }).toContain("#newtab");

      // Perception now runs on the adopted tab, not the original one.
      const onNewTab = await executeToolCall(
        { id: "q2", name: "query_dom", arguments: { question: "what is here" } },
        runtime,
      );
      expect(onNewTab.ok).toBe(true);
    } finally {
      for (const openPage of tabPage.context().pages()) {
        if (openPage !== tabPage && openPage !== page) {
          await openPage.close();
        }
      }
      await tabPage.close();
    }
  }, 30_000);

  test("modal dialog controls survive the candidate cap and are flagged (hh country-confirm pattern)", async (ctx) => {
    if (!browser) return ctx.skip();
    // 200 buttons exhaust the 120-candidate cap; the modal is portaled to the end of body.
    const longPageWithModal = `<!DOCTYPE html>
      <html><head><title>Long list</title></head><body>
        ${Array.from({ length: 200 }, (_, index) => `<button>Vacancy action ${index + 1}</button>`).join("\n")}
        <div role="dialog" aria-modal="true">
          <p>Вы откликаетесь на вакансию в другой стране. Продолжить?</p>
          <button id="dialog-continue">Продолжить</button>
          <button id="dialog-cancel">Отмена</button>
        </div>
      </body></html>`;
    await page.setContent(longPageWithModal);

    const perception = await collectPagePerception(page, {
      ariaSnapshotTimeoutMs: 5000,
      maxCandidateTextLength: 120,
    });

    expect(perception.dialogOpen).toBe(true);
    // Dialog content (container + its buttons) is ranked ahead of the 200 list buttons.
    const firstThree = perception.candidates.slice(0, 3);
    expect(firstThree.every((candidate) => candidate.inDialog)).toBe(true);
    expect(firstThree.map((candidate) => candidate.label)).toEqual(
      expect.arrayContaining(["Продолжить", "Отмена"]),
    );

    // The dialog button is clickable through its candidateId.
    const runtime = createBrowserToolRuntime(page);
    const queried = await executeToolCall({ id: "q", name: "query_dom", arguments: { question: "collect" } }, runtime);
    const cancel = (queried.content as { candidates: Array<{ candidateId: string; label: string }> }).candidates.find(
      (candidate) => candidate.label === "Отмена",
    );
    expect(cancel).toBeDefined();
    const clicked = await executeToolCall(
      { id: "c", name: "click", arguments: { candidateId: cancel!.candidateId } },
      runtime,
    );
    expect(clicked.ok).toBe(true);
  }, 30_000);

  test("re-querying the same page keeps candidate ids stable", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const first = await executeToolCall({ id: "q1", name: "query_dom", arguments: { question: "collect" } }, runtime);
    const second = await executeToolCall({ id: "q2", name: "query_dom", arguments: { question: "collect again" } }, runtime);

    const firstIds = (first.content as { candidates: Array<{ candidateId: string; label: string }> }).candidates;
    const secondIds = (second.content as { candidates: Array<{ candidateId: string; label: string }> }).candidates;
    expect(secondIds.map((candidate) => [candidate.candidateId, candidate.label])).toEqual(
      firstIds.map((candidate) => [candidate.candidateId, candidate.label]),
    );
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
