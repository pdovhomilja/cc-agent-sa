import { describe, it, expect } from "vitest";
import path from "node:path";
import { safeResolve } from "../src/tools/wiki-paths.js";

const ROOT = "/tmp/fake-wiki";

describe("safeResolve", () => {
  it("resolves a simple relative path under root", () => {
    expect(safeResolve(ROOT, "entities/acme.md")).toBe(
      path.join(ROOT, "entities/acme.md")
    );
  });

  it("resolves the root itself when given empty or '.'", () => {
    expect(safeResolve(ROOT, "")).toBe(ROOT);
    expect(safeResolve(ROOT, ".")).toBe(ROOT);
  });

  it("normalizes redundant segments", () => {
    expect(safeResolve(ROOT, "entities/./acme.md")).toBe(
      path.join(ROOT, "entities/acme.md")
    );
  });

  it("rejects parent-directory escapes", () => {
    expect(() => safeResolve(ROOT, "../etc/passwd")).toThrow(/outside wiki root/);
    expect(() => safeResolve(ROOT, "entities/../../secret")).toThrow(/outside wiki root/);
  });

  it("rejects absolute paths", () => {
    expect(() => safeResolve(ROOT, "/etc/passwd")).toThrow(/absolute/);
  });

  it("rejects null bytes", () => {
    expect(() => safeResolve(ROOT, "entities/\0acme")).toThrow(/null byte/);
  });
});
