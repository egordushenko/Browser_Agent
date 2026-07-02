import process from "node:process";
import { getUsageText, loadConfig, parseCliArgs } from "./config.js";
import { launchBrowserSession } from "./browser/session.js";
import { startRepl } from "./repl.js";

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(`${getUsageText()}\n`);
    return;
  }

  const config = loadConfig(process.env, process.argv.slice(2), process.cwd());
  const session = await launchBrowserSession(config.browser);

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
        process.stdout.write(`M0 skeleton received task, no agent loop yet: ${JSON.stringify(task)}\n`);
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
