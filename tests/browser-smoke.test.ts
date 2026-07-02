import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createBrowserToolRuntime, executeToolCall } from "../src/agent/tools.js";
import { collectPagePerception } from "../src/browser/perception.js";

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
    const selectors = perception.candidates.map((candidate) => candidate.selector);
    expect(selectors).toContain("css=#search");
    expect(selectors).toContain("css=#resume-tab");
    expect(selectors).toContain('css=[data-testid="search-submit"]');
    expect(selectors).toContain('css=[aria-label="Add classic hot dog to cart"]');
  }, 30_000);

  test("click and type work through runtime selectors and mutate the page", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const typed = await executeToolCall(
      { id: "t", name: "type", arguments: { selector: "css=#search", text: "hot dog" } },
      runtime,
    );
    expect(typed.ok).toBe(true);
    expect(await page.inputValue("#search")).toBe("hot dog");

    const clicked = await executeToolCall(
      { id: "c", name: "click", arguments: { selector: 'css=[aria-label="Add classic hot dog to cart"]' } },
      runtime,
    );
    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#cart-count")).toBe("1");
  }, 30_000);

  test("role selectors click the intended control when text is ambiguous", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const clicked = await executeToolCall(
      { id: "tab", name: "click", arguments: { selector: 'role=tab[name="Resume"]' } },
      runtime,
    );

    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#active-tab")).toBe("resume");
  }, 30_000);

  test("text selectors prefer exact visible text before substring matching", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);

    const clicked = await executeToolCall(
      { id: "text-tab", name: "click", arguments: { selector: "text=Resume" } },
      runtime,
    );

    expect(clicked.ok).toBe(true);
    expect(await page.textContent("#active-tab")).toBe("resume");
  }, 30_000);

  test("a stale selector surfaces as a recoverable tool error", async (ctx) => {
    if (!browser) return ctx.skip();
    await page.setContent(FIXTURE_HTML);
    const runtime = createBrowserToolRuntime(page);
    page.setDefaultTimeout(1_000);

    const first = await executeToolCall({ id: "v1", name: "click", arguments: { selector: "css=#vanishing" } }, runtime);
    expect(first.ok).toBe(true);

    const second = await executeToolCall(
      { id: "v2", name: "click", arguments: { selector: "css=#vanishing" } },
      runtime,
    );
    expect(second.ok).toBe(false);
    expect(String(second.content)).toContain("Timeout");
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
