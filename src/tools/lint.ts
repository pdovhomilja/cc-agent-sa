import fs from "node:fs";
import path from "node:path";
import { listWikiPages } from "./wiki-fs.js";

export interface LintReport {
  orphans: string[];
  brokenLinks: Array<{ from: string; to: string }>;
  emptyPages: string[];
  missingFrontMatter: string[];
}

const EXEMPT_FILES = new Set(["index.md", "log.md", "README.md", "CLAUDE.md"]);
const LINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const FRONT_MATTER_REGEX = /^---\n[\s\S]*?\n---\n/;

function readPage(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function stripFrontMatter(content: string): string {
  return content.replace(FRONT_MATTER_REGEX, "");
}

// Does not strip fenced code blocks — [[links]] inside ``` will cause false-positive broken-link reports.
function extractLinks(content: string): string[] {
  const links: string[] = [];
  const body = stripFrontMatter(content);
  let m: RegExpExecArray | null;
  LINK_REGEX.lastIndex = 0;
  while ((m = LINK_REGEX.exec(body)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}

function linkTargetExists(root: string, target: string): boolean {
  const trimmed = target.replace(/\/$/, "");
  if (target.endsWith("/")) {
    return (
      fs.existsSync(path.join(root, trimmed)) &&
      fs.statSync(path.join(root, trimmed)).isDirectory()
    );
  }
  const withExt = trimmed.endsWith(".md") ? trimmed : trimmed + ".md";
  if (fs.existsSync(path.join(root, withExt))) return true;
  if (
    fs.existsSync(path.join(root, trimmed)) &&
    fs.statSync(path.join(root, trimmed)).isDirectory()
  ) {
    return true;
  }
  return false;
}

export function findOrphans(root: string): string[] {
  const pages = listWikiPages(root);
  const inbound = new Set<string>();
  for (const page of pages) {
    const links = extractLinks(readPage(root, page));
    for (const link of links) {
      const normalized = link.replace(/\/$/, "");
      const withExt = normalized.endsWith(".md") ? normalized : normalized + ".md";
      inbound.add(withExt);
      inbound.add(normalized);
    }
  }
  return pages.filter((p) => {
    if (EXEMPT_FILES.has(path.basename(p))) return false;
    return !inbound.has(p) && !inbound.has(p.replace(/\.md$/, ""));
  });
}

export function findBrokenLinks(root: string): Array<{ from: string; to: string }> {
  const result: Array<{ from: string; to: string }> = [];
  for (const page of listWikiPages(root)) {
    const links = extractLinks(readPage(root, page));
    for (const link of links) {
      if (!linkTargetExists(root, link)) {
        result.push({ from: page, to: link });
      }
    }
  }
  return result;
}

export function findEmptyPages(root: string): string[] {
  return listWikiPages(root).filter((page) => {
    const content = readPage(root, page);
    const body = stripFrontMatter(content);
    return body.trim() === "";
  });
}

export function findMissingFrontMatter(root: string): string[] {
  return listWikiPages(root).filter((page) => {
    if (EXEMPT_FILES.has(path.basename(page))) return false;
    const content = readPage(root, page);
    return !content.startsWith("---\n");
  });
}

export function lintWiki(root: string): LintReport {
  return {
    orphans: findOrphans(root),
    brokenLinks: findBrokenLinks(root),
    emptyPages: findEmptyPages(root),
    missingFrontMatter: findMissingFrontMatter(root),
  };
}
