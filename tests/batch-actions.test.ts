import { describe, expect, test } from "vitest";
import type { Page } from "playwright";
import { ObjectMemory } from "../src/agent/object-memory.js";
import { createBrowserToolRuntime, executeToolCall, type BrowserToolRuntime } from "../src/agent/tools.js";

interface BatchSetup {
  answers: string[];
  asked: string[];
  memory: ObjectMemory;
  runtime: BrowserToolRuntime;
}

function setup(answer = "y"): BatchSetup {
  const memory = new ObjectMemory();
  const asked: string[] = [];
  const runtime = createBrowserToolRuntime({} as Page, undefined, {
    askUser: async (question) => {
      asked.push(question);
      return answer;
    },
    objectMemory: memory,
  });
  return { answers: [answer], asked, memory, runtime };
}

describe("batch selection workflow", () => {
  test("propose_selection rejects objects that were only seen in a list", async () => {
    const { memory, runtime } = setup();
    const [email] = memory.ingest([{ title: "Скидки недели", type: "email" }]);

    const result = await executeToolCall(
      {
        id: "p",
        name: "propose_selection",
        arguments: { objectType: "email", objectIds: [email.objectId], reason: "looks like spam" },
      },
      runtime,
    );

    expect(result.ok).toBe(false);
    expect(String(result.content)).toContain("review_required");
    expect(memory.get(email.objectId).status).toBe("seen");
  });

  test("propose_selection enforces the declared object type", async () => {
    const { memory, runtime } = setup();
    const [vacancy] = memory.ingest([{ title: "AI Engineer", type: "vacancy" }]);
    memory.setStatus(vacancy.objectId, "opened");

    const result = await executeToolCall(
      { id: "p", name: "propose_selection", arguments: { objectType: "email", objectIds: [vacancy.objectId], reason: "x" } },
      runtime,
    );

    expect(result.ok).toBe(false);
    expect(String(result.content)).toContain('has type "vacancy"');
  });

  test("confirm_batch moves selected objects to action_ready on a positive answer", async () => {
    const { asked, memory, runtime } = setup("Подтверждаю");
    const objects = memory.ingest([
      { title: "Spam 1", type: "email" },
      { title: "Spam 2", type: "email" },
    ]);
    for (const object of objects) {
      memory.setStatus(object.objectId, "opened");
    }
    await runtime.proposeSelection?.("email", objects.map((object) => object.objectId), "spam");

    const confirmation = await executeToolCall(
      { id: "c", name: "confirm_batch", arguments: { summary: "Удалить 2 спам-письма" } },
      runtime,
    );

    expect(confirmation.content).toMatchObject({ confirmed: true });
    expect(asked[0]).toContain("Удалить 2 спам-письма");
    expect(asked[0]).toContain('o1 "Spam 1"');
    expect(memory.list({ status: "action_ready" })).toHaveLength(2);
  });

  test("a declined batch rejects the selected objects and unblocks done via incomplete_reason", async () => {
    const { memory, runtime } = setup("n");
    const [object] = memory.ingest([{ title: "Spam 1", type: "email" }]);
    memory.setStatus(object.objectId, "opened");
    await runtime.proposeSelection?.("email", [object.objectId], "spam");

    const confirmation = await runtime.confirmBatch?.("Удалить письмо");
    expect(confirmation).toMatchObject({ confirmed: false });
    expect(memory.get(object.objectId).status).toBe("rejected");

    // Nothing pending anymore: done passes without incomplete_reason.
    await expect(runtime.done("Batch declined by the user")).resolves.toMatchObject({ summary: "Batch declined by the user" });
  });

  test("execute_batch refuses destructive actions without confirmation", async () => {
    const { memory, runtime } = setup();
    const [object] = memory.ingest([{ title: "Spam 1", type: "email", actionCandidateId: "c9" }]);
    memory.setStatus(object.objectId, "selected");

    const result = await executeToolCall(
      { id: "e", name: "execute_batch", arguments: { action: "delete", objectIds: [object.objectId] } },
      runtime,
    );

    expect(result.ok).toBe(false);
    expect(String(result.content)).toContain("confirmation_required");
  });

  test("execute_batch stop_before_payment reports without clicking anything", async () => {
    const { memory, runtime } = setup();
    const [order] = memory.ingest([{ title: "Корзина с хот-догом", type: "product" }]);

    const result = await executeToolCall(
      { id: "e", name: "execute_batch", arguments: { action: "stop_before_payment", objectIds: [order.objectId] } },
      runtime,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toEqual({
      action: "stop_before_payment",
      results: [{ objectId: order.objectId, outcome: "stopped_before_payment" }],
    });
  });

  test("execute_batch surfaces stale/unknown action controls as recoverable errors", async () => {
    const { memory, runtime } = setup();
    const [ready] = memory.ingest([{ title: "Spam 1", type: "email", actionCandidateId: "c42" }]);
    memory.setStatus(ready.objectId, "action_ready");

    const stale = await executeToolCall(
      { id: "e", name: "execute_batch", arguments: { action: "delete", objectIds: [ready.objectId] } },
      runtime,
    );
    expect(stale.ok).toBe(false);
    expect(String(stale.content)).toContain('Unknown candidateId "c42"');

    const [withoutControl] = memory.ingest([{ title: "Spam 2", type: "email" }]);
    memory.setStatus(withoutControl.objectId, "action_ready");
    const missing = await executeToolCall(
      { id: "e2", name: "execute_batch", arguments: { action: "delete", objectIds: [withoutControl.objectId] } },
      runtime,
    );
    expect(missing.ok).toBe(false);
    expect(String(missing.content)).toContain("no known action control");
  });

  test("execute_batch validates the action name", async () => {
    const { runtime } = setup();
    const result = await executeToolCall(
      { id: "e", name: "execute_batch", arguments: { action: "purge", objectIds: ["o1"] } },
      runtime,
    );

    expect(result.ok).toBe(false);
    expect(String(result.content)).toContain('Unknown batch action "purge"');
  });
});
