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
    expect(config.llm.provider).toBe("openai");
    expect(config.llm.orchestratorModel).toBe("gpt-5.4-mini");
    expect(config.limits.maxSteps).toBe(40);
    expect(config.limits.maxConsecutiveErrors).toBe(5);
    expect(config.limits.maxNoProgress).toBe(4);
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

  test("allows OpenAI model overrides from env without requiring secrets in config", () => {
    const config = loadConfig(
      {
        OPENAI_API_KEY: "test-key",
        BROWSER_AGENT_ORCHESTRATOR_MODEL: "custom-orchestrator",
      },
      [],
      "D:\\workspace\\agent",
    );

    expect(config.llm.apiKey).toBe("test-key");
    expect(config.llm.orchestratorModel).toBe("custom-orchestrator");
  });

  test("supports an OpenAI-compatible base URL override for OpenRouter", () => {
    const config = loadConfig(
      {
        OPENAI_API_KEY: "test-key",
        BROWSER_AGENT_API_BASE_URL: "https://openrouter.ai/api/v1",
      },
      [],
      "D:\\workspace\\agent",
    );

    expect(config.llm.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(loadConfig({}, [], "D:\\workspace\\agent").llm.baseUrl).toBeUndefined();
  });
});
