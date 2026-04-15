import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import simpleGit from "simple-git";
import { writeWikiPage, appendWikiLog, readWikiPage } from "../src/tools/wiki-fs.js";
import { commitWiki } from "../src/tools/wiki-git.js";

let root: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-smoke-"));
  fs.mkdirSync(path.join(root, "entities"), { recursive: true });
  fs.writeFileSync(path.join(root, "log.md"), "# Log\n\n---\n");
  fs.writeFileSync(path.join(root, "index.md"), "# Index\n");
  const git = simpleGit(root);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  await git.add("-A");
  await git.commit("seed");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("librarian pipeline end-to-end (fs + git)", () => {
  it("creates a page, logs it, and commits atomically", async () => {
    writeWikiPage(
      root,
      "entities/acme.md",
      "---\ntitle: Acme\ntype: entity\ncreated: 2026-04-15\nupdated: 2026-04-15\n---\n\n# Acme\n\nA test entity.\n"
    );
    appendWikiLog(root, "2026-04-15 10:00 | CREATE | entities/acme.md | seeded from smoke test");
    const hash = await commitWiki(root, "ingest: add Acme entity");

    expect(hash).not.toBe("no-changes");
    expect(readWikiPage(root, "entities/acme.md")).toMatch(/# Acme/);
    expect(readWikiPage(root, "log.md")).toMatch(/CREATE \| entities\/acme\.md/);

    const log = await simpleGit(root).log();
    expect(log.latest?.message).toBe("ingest: add Acme entity");
  });
});
