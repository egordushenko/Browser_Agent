import type { ObjectMemory } from "./object-memory.js";
import type { MemoryObject } from "../types.js";

export const BATCH_ACTIONS = ["delete", "mark_spam", "add_to_cart", "apply", "send_message", "stop_before_payment"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

const DESTRUCTIVE_ACTIONS: readonly BatchAction[] = ["delete", "mark_spam", "apply", "send_message"];

export function isDestructiveBatchAction(action: BatchAction): boolean {
  return DESTRUCTIVE_ACTIONS.includes(action);
}

/** review_required: an object must have been opened/studied before it can be selected. */
export function assertSelectable(object: MemoryObject): void {
  if (object.status === "seen") {
    throw new Error(
      `Checkpoint review_required: object ${object.objectId} ("${object.title}") was only seen in a list. ` +
        "Open its detail view (open_candidate/click) and extract details before selecting it.",
    );
  }
  if (object.status === "rejected" || object.status === "action_done") {
    throw new Error(`Checkpoint selection_required: object ${object.objectId} has status "${object.status}" and cannot be selected.`);
  }
}

/** confirmation_required: destructive actions run only on user-confirmed (action_ready) objects. */
export function assertExecutable(object: MemoryObject, action: BatchAction): void {
  if (action === "stop_before_payment") {
    return;
  }
  if (object.status === "action_done") {
    throw new Error(`Object ${object.objectId} already has status action_done; do not repeat the action.`);
  }
  if (isDestructiveBatchAction(action) && object.status !== "action_ready") {
    throw new Error(
      `Checkpoint confirmation_required: object ${object.objectId} has status "${object.status}". ` +
        `Run propose_selection and confirm_batch before executing "${action}".`,
    );
  }
  if (!isDestructiveBatchAction(action) && !["selected", "action_ready"].includes(object.status)) {
    throw new Error(
      `Checkpoint selection_required: object ${object.objectId} has status "${object.status}". ` +
        `Run propose_selection before executing "${action}".`,
    );
  }
}

/** completion_required: done is possible only when no batch workflow is left half-finished. */
export function missingCheckpointsForDone(memory: ObjectMemory): string[] {
  const missing: string[] = [];

  const selected = memory.list({ status: "selected" });
  if (selected.length > 0) {
    missing.push(
      `confirmation_required: ${formatIds(selected)} are selected but the batch was never confirmed (confirm_batch).`,
    );
  }

  const actionReady = memory.list({ status: "action_ready" });
  if (actionReady.length > 0) {
    missing.push(
      `completion_required: ${formatIds(actionReady)} are confirmed but the action was never executed (execute_batch).`,
    );
  }

  return missing;
}

function formatIds(objects: MemoryObject[]): string {
  return objects.map((object) => `${object.objectId} ("${object.title}")`).join(", ");
}
