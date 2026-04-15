import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readScratchpad,
  writeScratchpad,
  appendScratchpad,
  listScratchpad,
} from "../src/tools/scratchpad-fs.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-test-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("writeScratchpad", () => {
  it("creates a file under <root>/<role>/ and returns its relative path", () => {
    const rel = writeScratchpad(root, "coder", "notes.md", "hello");
    expect(rel).toBe("notes.md");
    expect(fs.readFileSync(path.join(root, "coder", "notes.md"), "utf8")).toBe("hello");
  });

  it("creates the role directory on first write", () => {
    writeScratchpad(root, "reviewer", "a.md", "x");
    expect(fs.existsSync(path.join(root, "reviewer"))).toBe(true);
  });

  it("refuses paths outside the role directory", () => {
    expect(() => writeScratchpad(root, "coder", "../evil.md", "x")).toThrow(/outside/);
  });
});

describe("readScratchpad", () => {
  it("returns file contents", () => {
    writeScratchpad(root, "coder", "a.md", "hi");
    expect(readScratchpad(root, "coder", "a.md")).toBe("hi");
  });

  it("throws on missing file", () => {
    expect(() => readScratchpad(root, "coder", "nope.md")).toThrow(/not found/);
  });
});

describe("appendScratchpad", () => {
  it("creates the file if missing and appends on subsequent calls", () => {
    appendScratchpad(root, "coder", "log.md", "line1\n");
    appendScratchpad(root, "coder", "log.md", "line2\n");
    expect(readScratchpad(root, "coder", "log.md")).toBe("line1\nline2\n");
  });
});

describe("listScratchpad", () => {
  it("lists markdown files in the role directory only", () => {
    writeScratchpad(root, "coder", "a.md", "a");
    writeScratchpad(root, "reviewer", "b.md", "b");
    expect(listScratchpad(root, "coder").sort()).toEqual(["a.md"]);
    expect(listScratchpad(root, "reviewer").sort()).toEqual(["b.md"]);
  });

  it("returns empty array when the role directory doesn't exist", () => {
    expect(listScratchpad(root, "ceo")).toEqual([]);
  });
});
