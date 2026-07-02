import { describe, expect, test } from "vitest";
import { Readable, Writable } from "node:stream";
import { formatTaskAcceptedLog, normalizeTaskInput, startRepl } from "../src/repl.js";

describe("normalizeTaskInput", () => {
  test("trims a natural-language task", () => {
    expect(normalizeTaskInput("  open a page  ")).toEqual({ kind: "task", task: "open a page" });
  });

  test("maps blank input and exit commands to control results", () => {
    expect(normalizeTaskInput("   ")).toEqual({ kind: "empty" });
    expect(normalizeTaskInput("exit")).toEqual({ kind: "exit" });
    expect(normalizeTaskInput(" quit ")).toEqual({ kind: "exit" });
  });
});

describe("formatTaskAcceptedLog", () => {
  test("prints the task in a stable log format", () => {
    expect(formatTaskAcceptedLog("open a page")).toBe('Task accepted: "open a page"');
  });
});

describe("startRepl", () => {
  test("drains piped task input and exits without waiting for an interactive prompt", async () => {
    const handledTasks: string[] = [];
    const outputChunks: string[] = [];
    const input = Readable.from(["Open https://example.com\n", "exit\n"]);
    const output = new Writable({
      write(chunk, _encoding, callback) {
        outputChunks.push(String(chunk));
        callback();
      },
    });

    await Promise.race([
      startRepl({
        input,
        output,
        prompt: "browser-agent> ",
        handleTask: async (task) => {
          handledTasks.push(task);
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("REPL did not finish piped input")), 500);
      }),
    ]);

    expect(handledTasks).toEqual(["Open https://example.com"]);
    expect(outputChunks.join("")).toContain("Stopping Browser Agent.");
  });
});
