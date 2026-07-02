import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export type NormalizedTaskInput =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "task"; task: string };

export interface ReplOptions {
  input: Readable;
  output: Writable;
  prompt: string;
  handleTask: (task: string) => Promise<void>;
}

export function normalizeTaskInput(input: string): NormalizedTaskInput {
  const task = input.trim();
  if (!task) {
    return { kind: "empty" };
  }
  if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") {
    return { kind: "exit" };
  }
  return { kind: "task", task };
}

export function formatTaskAcceptedLog(task: string): string {
  return `Task accepted: ${JSON.stringify(task)}`;
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const isInteractive = Boolean((options.input as Readable & { isTTY?: boolean }).isTTY);
  const rl: Interface = createInterface({
    input: options.input,
    output: options.output,
    terminal: isInteractive,
  });

  options.output.write("Enter a browser task, or type exit.\n");

  try {
    if (!isInteractive) {
      for await (const answer of rl) {
        const shouldContinue = await handleReplInput(answer, options);
        if (!shouldContinue) {
          break;
        }
      }
      return;
    }

    while (true) {
      const answer = await rl.question(options.prompt);
      const shouldContinue = await handleReplInput(answer, options);
      if (!shouldContinue) {
        break;
      }
    }
  } finally {
    rl.close();
  }
}

async function handleReplInput(input: string, options: ReplOptions): Promise<boolean> {
  const normalized = normalizeTaskInput(input);

  if (normalized.kind === "empty") {
    return true;
  }
  if (normalized.kind === "exit") {
    options.output.write("Stopping Browser Agent.\n");
    return false;
  }

  options.output.write(`${formatTaskAcceptedLog(normalized.task)}\n`);
  await options.handleTask(normalized.task);
  return true;
}
