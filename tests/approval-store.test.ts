import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createApprovalStore } from "../src/publisher/approval-store.js";

describe("ApprovalStore", () => {
  let store: ReturnType<typeof createApprovalStore>;

  beforeEach(() => {
    const db = new Database(":memory:");
    store = createApprovalStore(db);
  });

  it("insert then get by message id returns correct row", () => {
    store.insert({ messageId: "msg-1", draftId: "draft-1", platform: "x" });
    const row = store.get("msg-1");
    expect(row).toBeDefined();
    expect(row!.messageId).toBe("msg-1");
    expect(row!.draftId).toBe("draft-1");
    expect(row!.platform).toBe("x");
    expect(typeof row!.createdAt).toBe("number");
  });

  it("get unknown message id returns undefined", () => {
    const row = store.get("nonexistent");
    expect(row).toBeUndefined();
  });

  it("delete removes the row", () => {
    store.insert({ messageId: "msg-2", draftId: "draft-2", platform: "linkedin" });
    store.delete("msg-2");
    const row = store.get("msg-2");
    expect(row).toBeUndefined();
  });
});
