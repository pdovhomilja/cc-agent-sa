import fs from "node:fs";
import path from "node:path";
import { safeResolve } from "./wiki-paths.js";

export type DraftStatus =
  | "draft"
  | "ready-for-review"
  | "awaiting-approval"
  | "published"
  | "measured"
  | "rejected";

export type DraftPlatform = "x" | "linkedin";

export interface DraftFrontmatter {
  id: string;
  platform: DraftPlatform;
  status: DraftStatus;
  author: string;
  created: string;
  topic: string;
  post_text: string;
  source_urls?: string[];
  published_url?: string;
  published_at?: string;
  metrics?: { impressions?: number; engagement?: number; measured_at?: string };
}

export interface Draft {
  frontmatter: DraftFrontmatter;
  body: string;
}

export const ALLOWED_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  draft: ["ready-for-review", "rejected"],
  "ready-for-review": ["awaiting-approval", "draft", "rejected"],
  "awaiting-approval": ["published", "rejected", "ready-for-review"],
  published: ["measured"],
  measured: [],
  rejected: ["draft"],
};

// ---------------------------------------------------------------------------
// Minimal YAML parser
// ---------------------------------------------------------------------------

type YamlValue = string | number | boolean | string[] | Record<string, string | number | boolean>;

function parseYamlValue(raw: string): string | number | boolean {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  // strip quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseYaml(yaml: string): Record<string, YamlValue> {
  const lines = yaml.split("\n");
  const result: Record<string, YamlValue> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // skip blank lines
    if (line.trim() === "") { i++; continue; }

    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
    if (!topMatch) { i++; continue; }

    const key = topMatch[1];
    const rest = topMatch[2].trim();

    if (rest === "") {
      // could be array or nested map — look ahead
      i++;
      const items: string[] = [];
      const nested: Record<string, string | number | boolean> = {};
      let isArray = false;
      let isNested = false;

      while (i < lines.length) {
        const inner = lines[i];
        if (inner.trim() === "") { i++; continue; }
        const arrayMatch = inner.match(/^  - (.+)/);
        const nestedMatch = inner.match(/^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);

        if (arrayMatch) {
          isArray = true;
          items.push(arrayMatch[1].trim());
          i++;
        } else if (nestedMatch && !isArray) {
          isNested = true;
          nested[nestedMatch[1]] = parseYamlValue(nestedMatch[2]);
          i++;
        } else {
          break;
        }
      }

      if (isArray) result[key] = items;
      else if (isNested) result[key] = nested;
    } else {
      result[key] = parseYamlValue(rest);
      i++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Minimal YAML serializer
// ---------------------------------------------------------------------------

function needsQuoting(s: string): boolean {
  return s.includes(":") || s.includes("\n") || s.includes('"');
}

function serializeYamlValue(v: string | number | boolean): string {
  if (typeof v === "string" && needsQuoting(v)) return JSON.stringify(v);
  return String(v);
}

function serializeYaml(obj: Record<string, YamlValue>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) lines.push(`  - ${item}`);
    } else if (typeof val === "object") {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(val)) {
        lines.push(`  ${k}: ${serializeYamlValue(v as string | number | boolean)}`);
      }
    } else {
      lines.push(`${key}: ${serializeYamlValue(val)}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parse / serialize Draft
// ---------------------------------------------------------------------------

export function parseDraft(raw: string): Draft {
  if (!raw.startsWith("---")) {
    throw new Error("Invalid draft: missing frontmatter (must start with ---)");
  }
  const afterFirst = raw.slice(3);
  const endIdx = afterFirst.indexOf("\n---");
  if (endIdx === -1) {
    throw new Error("Invalid draft: unclosed frontmatter");
  }
  const yamlStr = afterFirst.slice(0, endIdx);
  // skip \n--- then strip leading newlines (the blank separator line)
  const bodyRaw = afterFirst.slice(endIdx + 4).replace(/^\n+/, "");
  const body = bodyRaw;

  const parsed = parseYaml(yamlStr);

  const frontmatter: DraftFrontmatter = {
    id: parsed.id as string,
    platform: parsed.platform as DraftPlatform,
    status: parsed.status as DraftStatus,
    author: parsed.author as string,
    created: parsed.created as string,
    topic: parsed.topic as string,
    post_text: parsed.post_text as string,
  };

  if (parsed.source_urls !== undefined) {
    frontmatter.source_urls = parsed.source_urls as string[];
  }
  if (parsed.published_url !== undefined) {
    frontmatter.published_url = parsed.published_url as string;
  }
  if (parsed.published_at !== undefined) {
    frontmatter.published_at = parsed.published_at as string;
  }
  if (parsed.metrics !== undefined) {
    frontmatter.metrics = parsed.metrics as DraftFrontmatter["metrics"];
  }

  return { frontmatter, body };
}

export function serializeDraft(d: Draft): string {
  const fm = d.frontmatter;
  // Build ordered yaml object
  const obj: Record<string, YamlValue> = {
    id: fm.id,
    platform: fm.platform,
    status: fm.status,
    author: fm.author,
    created: fm.created,
    topic: fm.topic,
    post_text: fm.post_text,
  };
  if (fm.source_urls) obj.source_urls = fm.source_urls;
  if (fm.published_url) obj.published_url = fm.published_url;
  if (fm.published_at) obj.published_at = fm.published_at;
  if (fm.metrics) obj.metrics = fm.metrics as Record<string, string | number | boolean>;

  return `---\n${serializeYaml(obj)}\n---\n\n${d.body}`;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

function draftsDir(wikiRoot: string): string {
  return path.join(wikiRoot, "drafts");
}

export function readDraft(wikiRoot: string, id: string): Draft {
  const abs = safeResolve(draftsDir(wikiRoot), `${id}.md`);
  if (!fs.existsSync(abs)) {
    throw new Error(`Draft not found: ${id}`);
  }
  return parseDraft(fs.readFileSync(abs, "utf8"));
}

export function writeDraft(wikiRoot: string, draft: Draft): string {
  const dir = draftsDir(wikiRoot);
  const abs = safeResolve(dir, `${draft.frontmatter.id}.md`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeDraft(draft), "utf8");
  return abs;
}

export function transitionDraft(
  wikiRoot: string,
  id: string,
  nextStatus: DraftStatus,
  patch?: Partial<DraftFrontmatter>
): Draft {
  const draft = readDraft(wikiRoot, id);
  const current = draft.frontmatter.status;
  if (!ALLOWED_TRANSITIONS[current].includes(nextStatus)) {
    throw new Error(
      `Invalid transition: ${current} → ${nextStatus}. Allowed: ${ALLOWED_TRANSITIONS[current].join(", ") || "none"}`
    );
  }
  draft.frontmatter = { ...draft.frontmatter, ...patch, status: nextStatus };
  writeDraft(wikiRoot, draft);
  return draft;
}
