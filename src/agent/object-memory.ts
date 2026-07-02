import type { ExtractedObjectDraft, ExtractedObjectType, MemoryObject, ObjectStatus } from "../types.js";

const STATUS_RANK: Record<ObjectStatus, number> = {
  seen: 0,
  opened: 1,
  details_extracted: 2,
  reviewed: 3,
  selected: 4,
  rejected: 4,
  action_ready: 5,
  action_done: 6,
};

export interface ObjectMemoryFilter {
  status?: ObjectStatus;
  type?: ExtractedObjectType;
}

/**
 * Cross-page memory of structured objects (emails, products, vacancies, resumes).
 * Objects keep a stable objectId while their page-scoped candidate ids are refreshed
 * on every extraction; statuses move forward through the task workflow.
 */
export class ObjectMemory {
  private readonly objects: MemoryObject[] = [];
  private counter = 0;

  ingest(drafts: ExtractedObjectDraft[]): MemoryObject[] {
    return drafts
      .filter((draft) => typeof draft.title === "string" && draft.title.trim().length > 0)
      .map((draft) => this.ingestOne(draft));
  }

  get(objectId: string): MemoryObject {
    const object = this.objects.find((candidate) => candidate.objectId === objectId);
    if (!object) {
      throw new Error(`Unknown objectId "${objectId}". Use objectIds returned by query_dom results.`);
    }
    return object;
  }

  list(filter?: ObjectMemoryFilter): MemoryObject[] {
    return this.objects.filter(
      (object) => (!filter?.type || object.type === filter.type) && (!filter?.status || object.status === filter.status),
    );
  }

  /** Upgrade an object's status; statuses never move backwards. */
  setStatus(objectId: string, status: ObjectStatus): MemoryObject {
    const object = this.get(objectId);
    if (object.status === "action_done" && status !== "action_done") {
      throw new Error(`Object ${objectId} is already action_done and cannot change status.`);
    }
    object.status = status;
    return object;
  }

  markOpenedByCandidate(candidateId: string): MemoryObject | undefined {
    const object = this.objects.find((candidate) => candidate.candidateId === candidateId);
    if (object && STATUS_RANK[object.status] < STATUS_RANK.opened) {
      object.status = "opened";
    }
    return object;
  }

  /** Compact one-line-per-object digest for the orchestrator context. */
  summary(maxItems = 30): string {
    if (this.objects.length === 0) {
      return "";
    }
    const lines = this.objects.slice(-maxItems).map((object) => {
      const fields = Object.entries(object.fields)
        .slice(0, 4)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      return `${object.objectId} [${object.type}/${object.status}] ${object.title}${fields ? ` (${fields})` : ""}`;
    });
    const omitted = this.objects.length - lines.length;
    if (omitted > 0) {
      lines.unshift(`(+${omitted} earlier objects omitted)`);
    }
    return lines.join("\n");
  }

  private ingestOne(draft: ExtractedObjectDraft): MemoryObject {
    const key = objectKey(draft.type, draft.title);
    const existing = this.objects.find((object) => objectKey(object.type, object.title) === key);

    if (existing) {
      const gainedFields = mergeFields(existing.fields, draft.fields);
      // Candidate ids are page-scoped: always refresh them from the latest extraction.
      if (draft.candidateId) {
        existing.candidateId = draft.candidateId;
      }
      if (draft.actionCandidateId) {
        existing.actionCandidateId = draft.actionCandidateId;
      }
      if (draft.url) {
        existing.url = draft.url;
      }
      if (gainedFields && existing.status === "opened") {
        existing.status = "details_extracted";
      }
      return existing;
    }

    this.counter += 1;
    const object: MemoryObject = {
      ...(draft.actionCandidateId ? { actionCandidateId: draft.actionCandidateId } : {}),
      ...(draft.candidateId ? { candidateId: draft.candidateId } : {}),
      fields: { ...(draft.fields ?? {}) },
      objectId: `o${this.counter}`,
      status: "seen",
      title: draft.title.trim(),
      type: draft.type,
      ...(draft.url ? { url: draft.url } : {}),
    };
    this.objects.push(object);
    return object;
  }
}

function objectKey(type: ExtractedObjectType, title: string): string {
  return `${type}|${title.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function mergeFields(target: Record<string, string>, source: Record<string, string> | undefined): boolean {
  if (!source) {
    return false;
  }
  let gained = false;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    if (target[key] !== value) {
      if (!(key in target)) {
        gained = true;
      }
      target[key] = value;
    }
  }
  return gained;
}
