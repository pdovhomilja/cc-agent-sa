import fs from "node:fs";
import path from "node:path";
import { safeResolve } from "./wiki-paths.js";

function roleRoot(root: string, role: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  return path.join(root, role);
}

export function readScratchpad(root: string, role: string, relative: string): string {
  const base = roleRoot(root, role);
  const abs = safeResolve(base, relative);
  if (!fs.existsSync(abs)) {
    throw new Error(`Scratchpad page not found: ${role}/${relative}`);
  }
  return fs.readFileSync(abs, "utf8");
}

export function writeScratchpad(
  root: string,
  role: string,
  relative: string,
  content: string
): string {
  const base = roleRoot(root, role);
  const abs = safeResolve(base, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return path.relative(base, abs).split(path.sep).join("/");
}

export function appendScratchpad(
  root: string,
  role: string,
  relative: string,
  content: string
): void {
  const base = roleRoot(root, role);
  const abs = safeResolve(base, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, content, "utf8");
}

export function listScratchpad(root: string, role: string): string[] {
  const base = roleRoot(root, role);
  if (!fs.existsSync(base)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(entry.name);
    }
  }
  return results;
}
