import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("uses safe persistent Chrome defaults", () => {
    const config = loadConfig({}, [], "D:\\workspace\\agent");

    expect(config.browser.channel).toBe("chrome");
    expect(config.browser.headless).toBe(false);
    expect(config.browser.resetProfile).toBe(false);
    expect(config.browser.userDataDir).toBe(path.resolve("D:\\workspace\\agent", ".browser-profile"));
    expect(config.browser.navTimeoutMs).toBe(30000);
  });

  test("allows profile reset and profile dir overrides from argv", () => {
    const config = loadConfig(
      {},
      ["--profile-dir", "D:\\profiles\\browser-agent", "--reset-profile"],
      "D:\\workspace\\agent",
    );

    expect(config.browser.userDataDir).toBe(path.resolve("D:\\profiles\\browser-agent"));
    expect(config.browser.resetProfile).toBe(true);
  });
});
