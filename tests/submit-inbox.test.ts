import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { submitToInbox } from "../src/tools/submit-inbox.js";

let wikiRoot: string;

beforeEach(() => {
  wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-test-"));
  fs.mkdirSync(path.join(wikiRoot, "inbox"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(wikiRoot, { recursive: true, force: true });
});

describe("submitToInbox", () => {
  it("writes a file under inbox/ with front-matter and body", () => {
    const filename = submitToInbox(wikiRoot, {
      role: "coder",
      missionId: "abc123",
      note: "I learned that the auth flow is stateful.",
    });
    expect(filename).toMatch(/^inbox\/.*\.md$/);
    const abs = path.join(wikiRoot, filename);
    expect(fs.existsSync(abs)).toBe(true);
    const content = fs.readFileSync(abs, "utf8");
    expect(content).toMatch(/type: inbox/);
    expect(content).toMatch(/submitted_by: coder/);
    expect(content).toMatch(/mission_id: abc123/);
    expect(content).toMatch(/I learned that the auth flow is stateful/);
  });

  it("creates the inbox directory if missing", () => {
    fs.rmSync(path.join(wikiRoot, "inbox"), { recursive: true });
    submitToInbox(wikiRoot, { role: "reviewer", missionId: null, note: "x" });
    expect(fs.existsSync(path.join(wikiRoot, "inbox"))).toBe(true);
  });

  it("omits mission_id field when not provided", () => {
    const filename = submitToInbox(wikiRoot, {
      role: "librarian",
      missionId: null,
      note: "no mission context",
    });
    const content = fs.readFileSync(path.join(wikiRoot, filename), "utf8");
    expect(content).not.toMatch(/mission_id:/);
  });

  it("generates unique filenames for concurrent calls", () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) {
      names.add(
        submitToInbox(wikiRoot, { role: "coder", missionId: "m", note: `n${i}` })
      );
    }
    expect(names.size).toBe(50);
  });
});
