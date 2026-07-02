import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

export type NormalizedTaskInput =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "task"; task: string };

export interface ReplIO {
  question: (prompt: string) => Promise<string>;
}

export interface ReplOptions {
  input: Readable;
  output: Writable;
  prompt: string;
  handleTask: (task: string, io: ReplIO) => Promise<void>;
  /** Lines arriving within this window are treated as one multiline paste and joined. */
  pasteJoinMs?: number;
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

class LineQueue {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];

  push(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
    } else {
      this.queue.push(line);
    }
  }

  next(): Promise<string> {
    const line = this.queue.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  nextWithin(ms: number): Promise<string | null> {
    const line = this.queue.shift();
    if (line !== undefined) {
      return Promise.resolve(line);
    }
    return new Promise((resolve) => {
      const waiter = (value: string) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        resolve(null);
      }, ms);
      this.waiters.push(waiter);
    });
  }
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const isInteractive = Boolean((options.input as Readable & { isTTY?: boolean }).isTTY);
  const rl: Interface = createInterface({
    input: options.input,
    output: options.output,
    terminal: isInteractive,
  });
  const pasteJoinMs = options.pasteJoinMs ?? 250;

  options.output.write("Enter a browser task, or type exit.\n");

  const lines = new LineQueue();
  rl.on("line", (line) => lines.push(line));
  const closed = new Promise<null>((resolve) => rl.once("close", () => resolve(null)));
  const nextLine = () => Promise.race([lines.next(), closed]);

  // readline delivers buffered lines to us before the loop asks for the next task,
  // so the same queue can also answer mid-task questions (ask_user, security confirm).
  const io: ReplIO = {
    question: async (prompt) => {
      options.output.write(prompt);
      return (await nextLine()) ?? "";
    },
  };

  try {
    while (true) {
      if (isInteractive) {
        options.output.write(options.prompt);
      }

      let line = await nextLine();
      if (line === null) {
        return;
      }

      if (isInteractive) {
        // A multiline paste arrives as a burst of line events; join it into one task.
        // Piped input keeps line-per-task semantics for scripted runs.
        while (true) {
          const extra = await lines.nextWithin(pasteJoinMs);
          if (extra === null) {
            break;
          }
          line = `${line} ${extra}`;
        }
      }

      const shouldContinue = await handleReplInput(line, options, io);
      if (!shouldContinue) {
        return;
      }
    }
  } finally {
    rl.close();
  }
}

async function handleReplInput(input: string, options: ReplOptions, io: ReplIO): Promise<boolean> {
  const normalized = normalizeTaskInput(input);

  if (normalized.kind === "empty") {
    return true;
  }
  if (normalized.kind === "exit") {
    options.output.write("Stopping Browser Agent.\n");
    return false;
  }

  options.output.write(`${formatTaskAcceptedLog(normalized.task)}\n`);
  await options.handleTask(normalized.task, io);
  return true;
}
