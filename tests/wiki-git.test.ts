import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import simpleGit from "simple-git";
import { commitWiki } from "../src/tools/wiki-git.js";

let root: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-git-test-"));
  const git = simpleGit(root);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  fs.writeFileSync(path.join(root, "seed.md"), "seed");
  await git.add("seed.md");
  await git.commit("initial");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("commitWiki", () => {
  it("stages and commits all changes with the given message", async () => {
    fs.writeFileSync(path.join(root, "new.md"), "new");
    const hash = await commitWiki(root, "ingest: add new page");
    expect(hash).toMatch(/^[a-f0-9]{7,}$/);
    const log = await simpleGit(root).log();
    expect(log.latest?.message).toBe("ingest: add new page");
  });

  it("returns a sentinel and does nothing when there are no changes", async () => {
    const hash = await commitWiki(root, "noop");
    expect(hash).toBe("no-changes");
  });
});
