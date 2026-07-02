import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { BrowserConfig } from "../config.js";

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
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
    channel: config.channel,
    headless: config.headless,
  });
  context.setDefaultNavigationTimeout(config.navTimeoutMs);

  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    close: () => context.close(),
  };
}
