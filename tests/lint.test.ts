import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findOrphans,
  findBrokenLinks,
  findEmptyPages,
  findMissingFrontMatter,
  lintWiki,
} from "../src/tools/lint.js";

let root: string;

function writePage(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

const FM = `---\ntitle: x\ntype: entity\ncreated: 2026-04-15\nupdated: 2026-04-15\n---\n\n`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-test-"));
  fs.mkdirSync(path.join(root, "entities"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("findOrphans", () => {
  it("returns pages with no inbound links", () => {
    writePage("entities/acme.md", FM + "Acme page\n");
    writePage("entities/beta.md", FM + "See [[entities/acme]]\n");
    expect(findOrphans(root).sort()).toEqual(["entities/beta.md"]);
  });

  it("exempts index.md, log.md, README.md, CLAUDE.md", () => {
    writePage("index.md", FM + "root\n");
    writePage("log.md", "# Log\n");
    writePage("README.md", "# Readme\n");
    writePage("CLAUDE.md", "# Schema\n");
    expect(findOrphans(root)).toEqual([]);
  });

  it("returns empty when every page is linked", () => {
    writePage("index.md", FM + "[[entities/a]]\n");
    writePage("entities/a.md", FM + "[[entities/b]]\n");
    writePage("entities/b.md", FM + "[[entities/a]]\n");
    expect(findOrphans(root)).toEqual([]);
  });
});

describe("findBrokenLinks", () => {
  it("flags links to nonexistent targets", () => {
    writePage("entities/acme.md", FM + "See [[entities/ghost]]\n");
    const hits = findBrokenLinks(root);
    expect(hits).toEqual([{ from: "entities/acme.md", to: "entities/ghost" }]);
  });

  it("accepts links to existing .md files with or without extension in target", () => {
    writePage("entities/a.md", FM + "A\n");
    writePage("entities/b.md", FM + "See [[entities/a]]\n");
    expect(findBrokenLinks(root)).toEqual([]);
  });

  it("accepts links to existing directories", () => {
    writePage("entities/a.md", FM + "See [[entities/]]\n");
    expect(findBrokenLinks(root)).toEqual([]);
  });

  it("strips link labels", () => {
    writePage("entities/a.md", FM + "A\n");
    writePage("entities/b.md", FM + "See [[entities/a|the A page]]\n");
    expect(findBrokenLinks(root)).toEqual([]);
  });
});

describe("findEmptyPages", () => {
  it("flags pages with only front-matter", () => {
    writePage("entities/acme.md", FM);
    writePage("entities/beta.md", FM + "Has content\n");
    expect(findEmptyPages(root)).toEqual(["entities/acme.md"]);
  });

  it("treats whitespace-only bodies as empty", () => {
    writePage("entities/acme.md", FM + "  \n\n\t\n");
    expect(findEmptyPages(root)).toEqual(["entities/acme.md"]);
  });
});

describe("findMissingFrontMatter", () => {
  it("flags pages that don't start with ---", () => {
    writePage("entities/a.md", FM + "ok\n");
    writePage("entities/b.md", "# Just a heading\n");
    expect(findMissingFrontMatter(root).sort()).toEqual(["entities/b.md"]);
  });

  it("does not flag index.md or log.md", () => {
    writePage("index.md", "# Index\n");
    writePage("log.md", "# Log\n");
    expect(findMissingFrontMatter(root)).toEqual([]);
  });
});

describe("lintWiki", () => {
  it("runs all checks and returns a combined report", () => {
    writePage("entities/orphan.md", FM + "nothing links to me\n");
    writePage("entities/broken.md", FM + "[[entities/ghost]]\n");
    writePage("entities/empty.md", FM);
    writePage("entities/nofm.md", "no front matter\n");
    writePage("index.md", FM + "[[entities/broken]]\n[[entities/empty]]\n[[entities/nofm]]\n");
    const report = lintWiki(root);
    expect(report.orphans).toContain("entities/orphan.md");
    expect(report.brokenLinks).toEqual([
      { from: "entities/broken.md", to: "entities/ghost" },
    ]);
    expect(report.emptyPages).toContain("entities/empty.md");
    expect(report.missingFrontMatter).toContain("entities/nofm.md");
  });
});
