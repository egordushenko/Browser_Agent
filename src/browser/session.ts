import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BrowserConfig } from "../config.js";

export interface BrowserSession {
  /** The page the user currently sees: new tabs (target=_blank links) are adopted automatically. */
  activePage: () => Page;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

interface PageTrackerContext {
  on(event: "page", listener: (page: Page) => void): unknown;
  pages(): Page[];
}

export function trackActivePage(context: PageTrackerContext, initialPage: Page): () => Page {
  let active = initialPage;
  context.on("page", (newPage) => {
    active = newPage;
    newPage.once("close", () => {
      if (active === newPage) {
        active = lastOpenPage(context, initialPage);
      }
    });
  });
  return () => {
    if (!active.isClosed()) {
      return active;
    }
    active = lastOpenPage(context, initialPage);
    return active;
  };
}

function lastOpenPage(context: PageTrackerContext, fallback: Page): Page {
  const pages = context.pages().filter((page) => !page.isClosed());
  return pages.at(-1) ?? fallback;
}

export function assertSafeProfileDir(userDataDir: string): void {
  const resolved = path.resolve(userDataDir);
  const root = path.parse(resolved).root;
  const home = process.env.USERPROFILE ? path.resolve(process.env.USERPROFILE) : undefined;

  if (resolved === root || (home && resolved === home)) {
    throw new Error(`Refusing to use unsafe profile directory: ${resolved}`);
  }
}

export async function launchBrowserSession(config: BrowserConfig): Promise<BrowserSession> {
  assertSafeProfileDir(config.userDataDir);

  if (config.resetProfile) {
    await fs.rm(config.userDataDir, { recursive: true, force: true });
  }

  await fs.mkdir(config.userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    args: ["--start-maximized"],
    channel: config.channel,
    // Real Chrome sandbox on; without this Playwright adds --no-sandbox and Chrome shows a warning banner.
    chromiumSandbox: true,
    headless: config.headless,
    // No fixed viewport: the page fills the whole window instead of a 1280x720 area with gray padding.
    viewport: null,
  });
  // Element actions fail fast with a descriptive Playwright error instead of racing the step timeout.
  context.setDefaultTimeout(config.actionTimeoutMs);
  context.setDefaultNavigationTimeout(config.navTimeoutMs);

  const page = context.pages()[0] ?? (await context.newPage());
  return {
    activePage: trackActivePage(context, page),
    context,
    page,
    close: () => context.close(),
  };
}
