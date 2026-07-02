import { describe, expect, test } from "vitest";
import { ObjectMemory } from "../src/agent/object-memory.js";
import type { ExtractedObjectDraft } from "../src/types.js";

function emailDraft(index: number): ExtractedObjectDraft {
  return {
    candidateId: `c${index}`,
    fields: { sender: `sender-${index}@example.com`, subject: `Subject ${index}` },
    title: `Email ${index}`,
    type: "email",
  };
}

describe("ObjectMemory", () => {
  test("ingests a list of emails as tracked objects with stable ids", () => {
    const memory = new ObjectMemory();
    const objects = memory.ingest(Array.from({ length: 10 }, (_, index) => emailDraft(index + 1)));

    expect(objects).toHaveLength(10);
    expect(objects.map((object) => object.objectId)).toEqual(Array.from({ length: 10 }, (_, index) => `o${index + 1}`));
    expect(objects.every((object) => object.status === "seen")).toBe(true);
    expect(memory.list({ type: "email" })).toHaveLength(10);
  });

  test("re-ingesting the same object merges fields and refreshes candidate ids without duplicating", () => {
    const memory = new ObjectMemory();
    memory.ingest([{ candidateId: "c2", title: "Junior Python Engineer", type: "vacancy", fields: { company: "Acme" } }]);

    const [merged] = memory.ingest([
      {
        candidateId: "c7",
        title: "Junior Python Engineer",
        type: "vacancy",
        fields: { salary: "80000", requirements: "Python, AI" },
      },
    ]);

    expect(memory.list()).toHaveLength(1);
    expect(merged.objectId).toBe("o1");
    expect(merged.candidateId).toBe("c7");
    expect(merged.fields).toMatchObject({ company: "Acme", salary: "80000", requirements: "Python, AI" });
  });

  test("objects persist across page navigation and gain details after being opened", () => {
    const memory = new ObjectMemory();
    const [vacancy] = memory.ingest([{ candidateId: "c3", title: "AI Engineer", type: "vacancy" }]);

    memory.markOpenedByCandidate("c3");
    expect(memory.get(vacancy.objectId).status).toBe("opened");

    // New page: detail view extraction re-ingests the same object with more fields.
    const [detailed] = memory.ingest([
      { title: "AI Engineer", type: "vacancy", fields: { salary: "200000", company: "Tensor" } },
    ]);
    expect(detailed.objectId).toBe(vacancy.objectId);
    expect(detailed.status).toBe("details_extracted");
  });

  test("markOpenedByCandidate never downgrades a later status", () => {
    const memory = new ObjectMemory();
    const [object] = memory.ingest([{ candidateId: "c1", title: "Email 1", type: "email" }]);
    memory.setStatus(object.objectId, "selected");

    memory.markOpenedByCandidate("c1");

    expect(memory.get(object.objectId).status).toBe("selected");
  });

  test("setStatus refuses to change action_done objects", () => {
    const memory = new ObjectMemory();
    const [object] = memory.ingest([{ title: "Email 1", type: "email" }]);
    memory.setStatus(object.objectId, "action_done");

    expect(() => memory.setStatus(object.objectId, "selected")).toThrow(/action_done/);
  });

  test("summary lists ids, types, statuses and key fields", () => {
    const memory = new ObjectMemory();
    memory.ingest([emailDraft(1), { title: "Hot dog", type: "product", fields: { price: "199" } }]);

    const summary = memory.summary();

    expect(summary).toContain("o1 [email/seen] Email 1");
    expect(summary).toContain("o2 [product/seen] Hot dog (price=199)");
  });

  test("get rejects unknown object ids with a recovery hint", () => {
    const memory = new ObjectMemory();
    expect(() => memory.get("o42")).toThrow(/Unknown objectId/);
  });
});
