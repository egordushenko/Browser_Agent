import process from "node:process";
import { getUsageText, loadConfig, parseCliArgs } from "./config.js";
import { launchBrowserSession } from "./browser/session.js";
import { runAgentStep } from "./agent/orchestrator.js";
import { createBrowserToolRuntime } from "./agent/tools.js";
import { OpenAIProvider } from "./llm/openai.js";
import { startRepl } from "./repl.js";
import { DomAgent } from "./subagents/dom-agent.js";

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${getUsageText()}\n`);
    return;
  }

  const config = loadConfig(process.env, process.argv.slice(2), process.cwd());
  const session = await launchBrowserSession(config.browser);
  const provider = config.llm.apiKey
    ? new OpenAIProvider({
        apiKey: config.llm.apiKey,
        model: config.llm.orchestratorModel,
      })
    : null;
  const domProvider = config.llm.apiKey
    ? new OpenAIProvider({
        apiKey: config.llm.apiKey,
        model: config.llm.subAgentModel,
      })
    : null;
  const runtime = createBrowserToolRuntime(session.page, domProvider ? new DomAgent(domProvider) : undefined);

  const close = async () => {
    await session.close();
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(130));
  });

  try {
    process.stdout.write(`Visible Chrome profile: ${config.browser.userDataDir}\n`);
    await startRepl({
      input: process.stdin,
      output: process.stdout,
      prompt: config.repl.prompt,
      handleTask: async (task) => {
        if (!provider) {
          process.stdout.write("OPENAI_API_KEY is required for the M1 agent loop.\n");
          return;
        }

        const result = await runAgentStep({
          task,
          provider,
          runtime,
          observation: {
            url: session.page.url(),
            title: await session.page.title(),
            lastToolResult: null,
          },
        });

        process.stdout.write(`Using tool result: ${JSON.stringify(result.toolResult)}\n`);
        process.stdout.write(`Usage: ${JSON.stringify(result.usage)}\n`);
      },
    });
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exitCode = 1;
});
