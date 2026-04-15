import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readWikiPage,
  writeWikiPage,
  listWikiPages,
  searchWiki,
  appendWikiLog,
} from "../src/tools/wiki-fs.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-test-"));
  fs.mkdirSync(path.join(root, "entities"), { recursive: true });
  fs.writeFileSync(path.join(root, "log.md"), "# Log\n\n---\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("writeWikiPage", () => {
  it("creates a new file with content", () => {
    writeWikiPage(root, "entities/acme.md", "# Acme\n");
    expect(fs.readFileSync(path.join(root, "entities/acme.md"), "utf8")).toBe("# Acme\n");
  });

  it("creates parent directories as needed", () => {
    writeWikiPage(root, "projects/foo/bar.md", "# Bar\n");
    expect(fs.existsSync(path.join(root, "projects/foo/bar.md"))).toBe(true);
  });

  it("overwrites existing files", () => {
    writeWikiPage(root, "entities/acme.md", "v1");
    writeWikiPage(root, "entities/acme.md", "v2");
    expect(fs.readFileSync(path.join(root, "entities/acme.md"), "utf8")).toBe("v2");
  });

  it("refuses paths outside root", () => {
    expect(() => writeWikiPage(root, "../evil.md", "x")).toThrow(/outside wiki root/);
  });
});

describe("readWikiPage", () => {
  it("returns file contents", () => {
    fs.writeFileSync(path.join(root, "entities/acme.md"), "hello");
    expect(readWikiPage(root, "entities/acme.md")).toBe("hello");
  });

  it("throws on missing file", () => {
    expect(() => readWikiPage(root, "entities/nope.md")).toThrow(/not found/);
  });
});

describe("listWikiPages", () => {
  it("returns markdown files recursively, relative to root", () => {
    fs.writeFileSync(path.join(root, "entities/a.md"), "a");
    fs.mkdirSync(path.join(root, "concepts"), { recursive: true });
    fs.writeFileSync(path.join(root, "concepts/b.md"), "b");
    fs.writeFileSync(path.join(root, "entities/skip.txt"), "x");
    const pages = listWikiPages(root).sort();
    expect(pages).toContain("entities/a.md");
    expect(pages).toContain("concepts/b.md");
    expect(pages).not.toContain("entities/skip.txt");
  });

  it("can scope to a subdirectory", () => {
    fs.writeFileSync(path.join(root, "entities/a.md"), "a");
    fs.mkdirSync(path.join(root, "concepts"), { recursive: true });
    fs.writeFileSync(path.join(root, "concepts/b.md"), "b");
    const pages = listWikiPages(root, "entities");
    expect(pages).toEqual(["entities/a.md"]);
  });
});

describe("searchWiki", () => {
  it("returns paths of pages containing the query (case-insensitive)", () => {
    fs.writeFileSync(path.join(root, "entities/a.md"), "Acme Corporation launched");
    fs.writeFileSync(path.join(root, "entities/b.md"), "unrelated text");
    const hits = searchWiki(root, "acme");
    expect(hits.map((h) => h.path)).toEqual(["entities/a.md"]);
    expect(hits[0].snippet).toMatch(/Acme Corporation/);
  });

  it("returns empty array when no match", () => {
    fs.writeFileSync(path.join(root, "entities/a.md"), "nothing");
    expect(searchWiki(root, "xyz")).toEqual([]);
  });
});

describe("appendWikiLog", () => {
  it("appends a line to log.md", () => {
    appendWikiLog(root, "2026-04-15 10:00 | CREATE | entities/a.md | test");
    const content = fs.readFileSync(path.join(root, "log.md"), "utf8");
    expect(content).toMatch(/2026-04-15 10:00 \| CREATE \| entities\/a\.md \| test/);
  });
});
