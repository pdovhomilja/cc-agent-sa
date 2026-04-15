import fs from "node:fs";
import path from "node:path";
import { safeResolve } from "./wiki-paths.js";

export interface SearchHit {
  path: string;
  snippet: string;
}

export function readWikiPage(root: string, relative: string): string {
  const abs = safeResolve(root, relative);
  if (!fs.existsSync(abs)) {
    throw new Error(`Wiki page not found: ${relative}`);
  }
  return fs.readFileSync(abs, "utf8");
}

export function writeWikiPage(root: string, relative: string, content: string): void {
  const abs = safeResolve(root, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

export function listWikiPages(root: string, subdir?: string): string[] {
  const base = subdir ? safeResolve(root, subdir) : path.resolve(root);
  const results: string[] = [];
  if (!fs.existsSync(base)) return results;
  walk(base, (abs) => {
    if (!abs.endsWith(".md")) return;
    results.push(path.relative(root, abs).split(path.sep).join("/"));
  });
  return results;
}

export function searchWiki(root: string, query: string): SearchHit[] {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const rel of listWikiPages(root)) {
    const abs = safeResolve(root, rel);
    const content = fs.readFileSync(abs, "utf8");
    const lc = content.toLowerCase();
    const idx = lc.indexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + needle.length + 80);
    hits.push({ path: rel, snippet: content.slice(start, end).replace(/\s+/g, " ").trim() });
  }
  return hits;
}

export function appendWikiLog(root: string, line: string): void {
  const abs = safeResolve(root, "log.md");
  const suffix = line.endsWith("\n") ? line : line + "\n";
  fs.appendFileSync(abs, suffix, "utf8");
}

function walk(dir: string, visit: (abs: string) => void): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, visit);
    else if (e.isFile()) visit(abs);
  }
}
