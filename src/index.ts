import process from "node:process";
import { getUsageText, loadConfig, parseCliArgs } from "./config.js";
import { launchBrowserSession } from "./browser/session.js";
import { ObjectMemory } from "./agent/object-memory.js";
import { runAgentTask } from "./agent/orchestrator.js";
import { extractAllowedNavigationUrls } from "./agent/navigation-policy.js";
import { SecurityGate } from "./agent/security.js";
import { createBrowserToolRuntime } from "./agent/tools.js";
import { OpenAIProvider } from "./llm/openai.js";
import { startRepl } from "./repl.js";
import { DomAgent } from "./subagents/dom-agent.js";
import { formatForLog } from "./terminal-format.js";
import type { Usage } from "./types.js";

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
        baseUrl: config.llm.baseUrl,
        model: config.llm.orchestratorModel,
      })
    : null;
  const domProvider = config.llm.apiKey
    ? new OpenAIProvider({
        apiKey: config.llm.apiKey,
        baseUrl: config.llm.baseUrl,
        model: config.llm.subAgentModel,
      })
    : null;
  const domAgent = domProvider ? new DomAgent(domProvider) : undefined;

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
      handleTask: async (task, io) => {
        if (!provider || !domProvider) {
          process.stdout.write("OPENAI_API_KEY is required for the agent loop.\n");
          return;
        }

        const objectMemory = new ObjectMemory();
        const runtime = createBrowserToolRuntime(session.page, domAgent, {
          allowedNavigationUrls: extractAllowedNavigationUrls(task),
          askUser: async (question) => io.question(`Agent question: ${question}\nanswer> `),
          objectMemory,
          screenshotDir: config.browser.screenshotDir,
        });

        const securityGate = new SecurityGate({
          confirm: async (message) => {
            const answer = await io.question(`\n${message}\nConfirm? [y/N] `);
            return /^y(es)?$/i.test(answer.trim());
          },
          onDecision: (decision, reviewInput) => {
            const verdict = decision.requiresConfirmation ? "confirmation required" : "allowed";
            process.stdout.write(`Security check: ${reviewInput.toolName} -> ${verdict} (${decision.reason})\n`);
          },
          provider: domProvider,
        });

        let totalUsage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        try {
          const result = await runAgentTask({
            contextOptions: {
              maxDetailedSteps: config.context.maxDetailedSteps,
              maxTextChars: config.context.maxTextChars,
            },
            limits: config.limits,
            objectMemory,
            observe: async () => ({
              url: session.page.url(),
              title: await session.page.title().catch(() => ""),
              lastToolResult: null,
            }),
            onToolCall: (call, stepIndex) => {
              process.stdout.write(`\nStep ${stepIndex + 1}\n`);
              process.stdout.write(`Using tool: ${call.name}\n`);
              process.stdout.write(`Input: ${JSON.stringify(call.arguments)}\n`);
            },
            onStepResult: (step) => {
              if (!step.toolCall) {
                process.stdout.write(`Model returned no tool call${step.text ? `: ${formatForLog(step.text)}` : "."}\n`);
              } else if (step.toolResult) {
                const status = step.toolResult.ok ? "Result" : "Error";
                process.stdout.write(`${status}: ${formatForLog(step.toolResult.content)}\n`);
              }
              totalUsage = addUsage(totalUsage, step.usage);
            },
            provider,
            runtime,
            securityGate,
            task,
          });

          const lastStep = result.steps.at(-1);
          if (result.stopReason === "done" && lastStep?.toolCall?.name === "done") {
            const summary = lastStep.toolCall.arguments.summary;
            process.stdout.write(`\nAgent report: ${typeof summary === "string" ? summary : ""}\n`);
          }
          process.stdout.write(
            `Agent stopped: ${result.stopReason} (steps: ${result.steps.length}, tokens: ${totalUsage.totalTokens})\n`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          process.stdout.write(`Task failed: ${message}\n`);
        }
      },
    });
  } finally {
    await close();
  }
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exitCode = 1;
});
