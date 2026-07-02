import { describe, expect, test } from "vitest";
import { PassThrough, Readable, Writable } from "node:stream";
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

  test("joins a multiline paste into one task in interactive mode", async () => {
    const handledTasks: string[] = [];
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const replDone = startRepl({
      input,
      output,
      prompt: "> ",
      pasteJoinMs: 40,
      handleTask: async (task) => {
        handledTasks.push(task);
        input.write("exit\n");
      },
    });

    input.write("Открой резюме и запомни\nзарплатные ожидания.\nЗатем найди вакансии.\n");

    await Promise.race([
      replDone,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("interactive REPL did not finish")), 2000);
      }),
    ]);

    expect(handledTasks).toEqual(["Открой резюме и запомни зарплатные ожидания. Затем найди вакансии."]);
  });

  test("absorbs a paste without a trailing newline instead of polluting the next answer", async () => {
    const handledTasks: string[] = [];
    const answers: string[] = [];
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const replDone = startRepl({
      input,
      output,
      prompt: "> ",
      pasteJoinMs: 40,
      handleTask: async (task, io) => {
        handledTasks.push(task);
        const promptPromise = io.question("Confirm? ");
        input.write("y\n");
        answers.push(await promptPromise);
        input.write("exit\n");
      },
    });

    // Clipboard content often ends without a newline: the last line stays in the edit buffer.
    input.write("Открой резюме\nи откликнись.\nПисьмо не отправляй");

    await Promise.race([
      replDone,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("interactive REPL did not finish")), 2000);
      }),
    ]);

    expect(handledTasks).toEqual(["Открой резюме и откликнись. Письмо не отправляй"]);
    expect(answers).toEqual(["y"]);
  });

  test("keeps mid-task question answers separate from the paste joiner", async () => {
    const answers: string[] = [];
    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const replDone = startRepl({
      input,
      output,
      prompt: "> ",
      pasteJoinMs: 40,
      handleTask: async (_task, io) => {
        const promptPromise = io.question("Confirm? [y/N] ");
        input.write("y\n");
        answers.push(await promptPromise);
        input.write("exit\n");
      },
    });

    input.write("Click the pay button\n");

    await Promise.race([
      replDone,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("interactive REPL did not finish")), 2000);
      }),
    ]);

    expect(answers).toEqual(["y"]);
  });
});
