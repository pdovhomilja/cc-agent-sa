import { describe, it, expect, vi } from "vitest";

vi.mock("../src/missions/store.js", () => ({ getMission: vi.fn() }));
vi.mock("../src/missions/worktree.js", () => ({ getDiff: vi.fn() }));
vi.mock("../src/agents/librarian.js", () => ({ runLibrarian: vi.fn() }));

import { buildCaptureTask } from "../src/missions/capture.js";

describe("buildCaptureTask", () => {
  it("includes mission id, brief, verdict, and diff in the task string", () => {
    const task = buildCaptureTask({
      missionId: "abc123",
      brief: "Add rate limiting to /api/auth/login",
      diff:"diff --git a/foo b/foo\n+const x = 1",
    });
    expect(task).toMatch(/abc123/);
    expect(task).toMatch(/Add rate limiting/);
    expect(task).toMatch(/APPROVE/);
    expect(task).toMatch(/const x = 1/);
    expect(task).toMatch(/missions\/abc123/);
  });

  it("truncates large diffs to a bounded size", () => {
    const hugeDiff = "x".repeat(100_000);
    const task = buildCaptureTask({
      missionId: "m",
      brief: "b",
      diff:hugeDiff,
    });
    expect(task.length).toBeLessThan(20_000);
    expect(task).toMatch(/truncated/);
  });

  it("instructs the Librarian to update affected entity/concept/project pages", () => {
    const task = buildCaptureTask({
      missionId: "m",
      brief: "b",
      diff:"d",
    });
    expect(task).toMatch(/entity|concept|project/i);
  });
});
