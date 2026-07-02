import { describe, expect, test } from "vitest";
import type { Page } from "playwright";
import { assertExecutable, assertSelectable, missingCheckpointsForDone } from "../src/agent/checkpoints.js";
import { ObjectMemory } from "../src/agent/object-memory.js";
import { createBrowserToolRuntime } from "../src/agent/tools.js";

function memoryWith(status: Parameters<ObjectMemory["setStatus"]>[1]): { memory: ObjectMemory; objectId: string } {
  const memory = new ObjectMemory();
  const [object] = memory.ingest([{ title: "Junior Python Engineer", type: "vacancy" }]);
  if (status !== "seen") {
    memory.setStatus(object.objectId, status);
  }
  return { memory, objectId: object.objectId };
}

describe("checkpoints", () => {
  test("selection requires the object to be opened or reviewed first", () => {
    const { memory, objectId } = memoryWith("seen");
    expect(() => assertSelectable(memory.get(objectId))).toThrow(/review_required/);

    memory.setStatus(objectId, "opened");
    expect(() => assertSelectable(memory.get(objectId))).not.toThrow();
  });

  test("rejected and finished objects cannot be re-selected", () => {
    const { memory, objectId } = memoryWith("rejected");
    expect(() => assertSelectable(memory.get(objectId))).toThrow(/selection_required/);
  });

  test("destructive actions require a confirmed (action_ready) object", () => {
    const { memory, objectId } = memoryWith("selected");
    expect(() => assertExecutable(memory.get(objectId), "apply")).toThrow(/confirmation_required/);

    memory.setStatus(objectId, "action_ready");
    expect(() => assertExecutable(memory.get(objectId), "apply")).not.toThrow();
  });

  test("non-destructive actions require at least a selection", () => {
    const { memory, objectId } = memoryWith("opened");
    expect(() => assertExecutable(memory.get(objectId), "add_to_cart")).toThrow(/selection_required/);

    memory.setStatus(objectId, "selected");
    expect(() => assertExecutable(memory.get(objectId), "add_to_cart")).not.toThrow();
  });

  test("stop_before_payment is always allowed and repeat actions are blocked", () => {
    const { memory, objectId } = memoryWith("seen");
    expect(() => assertExecutable(memory.get(objectId), "stop_before_payment")).not.toThrow();

    memory.setStatus(objectId, "action_done");
    expect(() => assertExecutable(memory.get(objectId), "delete")).toThrow(/action_done/);
  });

  test("done reports every unfinished batch checkpoint", () => {
    const memory = new ObjectMemory();
    const [a, b] = memory.ingest([
      { title: "Vacancy A", type: "vacancy" },
      { title: "Vacancy B", type: "vacancy" },
    ]);
    memory.setStatus(a.objectId, "selected");
    memory.setStatus(b.objectId, "action_ready");

    const missing = missingCheckpointsForDone(memory);

    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain("confirmation_required");
    expect(missing[0]).toContain(a.objectId);
    expect(missing[1]).toContain("completion_required");
    expect(missing[1]).toContain(b.objectId);
  });
});

describe("done checkpoint gate in the runtime", () => {
  test("done fails while a batch is pending and passes with an honest incomplete_reason", async () => {
    const objectMemory = new ObjectMemory();
    const [object] = objectMemory.ingest([{ title: "Vacancy A", type: "vacancy" }]);
    objectMemory.setStatus(object.objectId, "selected");
    const runtime = createBrowserToolRuntime({} as Page, undefined, { objectMemory });

    await expect(runtime.done("All finished")).rejects.toThrow(/missing checkpoints/);

    const honest = await runtime.done("Stopped early", "User declined the batch confirmation.");
    expect(honest).toEqual({ summary: "Stopped early", incompleteReason: "User declined the batch confirmation." });
  });

  test("done passes when the workflow is fully executed", async () => {
    const objectMemory = new ObjectMemory();
    const [object] = objectMemory.ingest([{ title: "Vacancy A", type: "vacancy" }]);
    objectMemory.setStatus(object.objectId, "action_done");
    const runtime = createBrowserToolRuntime({} as Page, undefined, { objectMemory });

    await expect(runtime.done("Applied to Vacancy A")).resolves.toEqual({ summary: "Applied to Vacancy A" });
  });
});
