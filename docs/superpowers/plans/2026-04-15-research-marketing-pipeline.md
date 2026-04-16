# Research + Marketing Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two peer agents — **Research** and **Marketing** — that run an end-to-end content pipeline: Research drafts X/LinkedIn posts into the wiki, Marketing measures metrics and publishes approved drafts via `xurl` after a human ✅ reaction in Discord.

**Architecture:**
- Wiki is the source of truth. Drafts live in `wiki/drafts/` as Markdown with frontmatter whose `status` field drives the state machine: `draft → ready-for-review → awaiting-approval → published → measured`.
- Two new Discord channels (`#research`, `#marketing`), each routed directly to its own agent runner. The CEO orchestrator is **not** in this pipeline — the human is the router.
- Agents never write to external systems. A separate **Publisher** module (plain Node, not an agent) executes `xurl`/LinkedIn calls only after a Discord reaction from an allowlisted user. This keeps the approval gate outside the agent sandbox.
- Cross-agent handoff happens via the draft file itself, not via delegation calls. Research flips status to `ready-for-review`; Marketing notices in its next turn and proposes publishing.

**Tech Stack:** Existing — TypeScript, `@anthropic-ai/claude-agent-sdk`, `discord.js`, `better-sqlite3`, `simple-git`, `vitest`. New external dependency: `xurl` CLI (Twitter OAuth1) on `$PATH`. PostHog MCP server configured externally.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/tools/drafts-fs.ts` | Parse/serialize draft frontmatter, state transitions, filename helpers |
| `src/tools/drafts.ts` | MCP server exposing draft-scoped tools (not raw wiki write) |
| `src/tools/marketing-read.ts` | MCP server for Marketing read-only ops (`xurl_get`) |
| `src/publisher/xurl.ts` | Shell out to `xurl` for X posts; arg escaping + error surfacing |
| `src/publisher/linkedin.ts` | LinkedIn posting (stub that throws `NotImplemented` v1) |
| `src/publisher/approval.ts` | Discord reaction handler; reads approval table, runs publisher, writes result back to draft |
| `src/publisher/approval-store.ts` | SQLite table: `approvals(message_id, draft_path, platform, created_at)` |
| `src/agents/researcher.ts` | `runResearcher` — drafts posts, mirrors `runLibrarian` pattern |
| `src/agents/marketer.ts` | `runMarketer` — measures and proposes publish |
| `src/tools/drafts-fs.test.ts` | Unit tests: frontmatter roundtrip, state transitions |
| `src/publisher/xurl.test.ts` | Unit tests: argv assembly, error mapping |
| `src/publisher/approval-store.test.ts` | Unit tests: insert/lookup/delete |
| `wiki/drafts/README.md` | Drafts convention doc — both agents read at start of every task |
| `wiki/drafts/.gitkeep` | Ensure directory exists on fresh clone |

### Modified files

| File | Change |
|---|---|
| `src/config.ts` | Add research/marketing channel IDs, xurl path, PostHog MCP config |
| `src/discord/handlers.ts` | Channel-based routing: `#research` → `runResearcher`, `#marketing` → `runMarketer`; add reaction listener |
| `src/agents/prompts.ts` | Add `RESEARCHER_SYSTEM_PROMPT`, `MARKETER_SYSTEM_PROMPT` |
| `src/missions/store.ts` | Extend `AgentSession.role` to include `researcher` and `marketer` |
| `.env.example` | Add new env vars |

---

## Phase 1 — Drafts Foundation

Goal: create the data layer for drafts. Nothing talks to an LLM in this phase. End state: unit-tested frontmatter/state-machine library + MCP server + wiki convention.

### Task 1.1: Frontmatter schema + parser

**Files:**
- Create: `src/tools/drafts-fs.ts`
- Create: `src/tools/drafts-fs.test.ts`

- [ ] **Step 1: Write failing test for frontmatter parse/serialize roundtrip**

Create `src/tools/drafts-fs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDraft, serializeDraft, type Draft } from "./drafts-fs.js";

describe("drafts-fs parseDraft", () => {
  it("parses frontmatter and body", () => {
    const raw = [
      "---",
      "id: 2026-04-15-x-ai-agents",
      "platform: x",
      "status: draft",
      "author: researcher",
      "created: 2026-04-15T10:00:00.000Z",
      "topic: AI agents in automation",
      "post_text: \"Hello world\"",
      "source_urls:",
      "  - https://example.com/a",
      "---",
      "",
      "Research notes body.",
      "",
    ].join("\n");

    const d = parseDraft(raw);
    expect(d.frontmatter.id).toBe("2026-04-15-x-ai-agents");
    expect(d.frontmatter.platform).toBe("x");
    expect(d.frontmatter.status).toBe("draft");
    expect(d.frontmatter.post_text).toBe("Hello world");
    expect(d.frontmatter.source_urls).toEqual(["https://example.com/a"]);
    expect(d.body.trim()).toBe("Research notes body.");
  });

  it("roundtrips parse → serialize → parse", () => {
    const input: Draft = {
      frontmatter: {
        id: "2026-04-15-x-test",
        platform: "x",
        status: "ready-for-review",
        author: "researcher",
        created: "2026-04-15T10:00:00.000Z",
        topic: "Test",
        post_text: "Hi",
        source_urls: ["https://example.com"],
      },
      body: "Body text",
    };
    const serialized = serializeDraft(input);
    const reparsed = parseDraft(serialized);
    expect(reparsed).toEqual(input);
  });

  it("rejects raw without frontmatter", () => {
    expect(() => parseDraft("just text")).toThrow(/frontmatter/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: FAIL — `Cannot find module './drafts-fs.js'`.

- [ ] **Step 3: Implement `drafts-fs.ts` minimal surface**

Create `src/tools/drafts-fs.ts`:

```typescript
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
  author: "researcher" | "marketer" | "human";
  created: string;
  topic: string;
  post_text: string;
  source_urls?: string[];
  published_url?: string;
  published_at?: string;
  metrics?: {
    impressions?: number;
    engagement?: number;
    measured_at?: string;
  };
}

export interface Draft {
  frontmatter: DraftFrontmatter;
  body: string;
}

const FM_DELIM = "---";

export function parseDraft(raw: string): Draft {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== FM_DELIM) {
    throw new Error("Draft missing frontmatter opening ---");
  }
  const end = lines.indexOf(FM_DELIM, 1);
  if (end === -1) {
    throw new Error("Draft missing frontmatter closing ---");
  }
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n/, "");
  const frontmatter = parseSimpleYaml(fmLines) as DraftFrontmatter;
  return { frontmatter, body };
}

export function serializeDraft(d: Draft): string {
  const fm = serializeSimpleYaml(d.frontmatter);
  return `${FM_DELIM}\n${fm}${FM_DELIM}\n\n${d.body}${d.body.endsWith("\n") ? "" : "\n"}`;
}

// Minimal YAML: string/number/bool scalars, string arrays, one level of nested map.
// We control the schema so we don't need a full YAML lib.
function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`Bad frontmatter line: ${line}`);
    const key = m[1];
    const rest = m[2];
    if (rest === "") {
      // Either a list or a nested map; peek ahead.
      const items: string[] = [];
      const nested: Record<string, string> = {};
      let mode: "list" | "map" | null = null;
      let j = i + 1;
      while (j < lines.length && /^\s+/.test(lines[j])) {
        const sub = lines[j];
        if (/^\s+-\s+/.test(sub)) {
          mode = "list";
          items.push(sub.replace(/^\s+-\s+/, "").trim());
        } else {
          const nm = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(sub);
          if (!nm) break;
          mode = "map";
          nested[nm[1]] = scalar(nm[2]) as string;
        }
        j++;
      }
      out[key] = mode === "list" ? items.map(scalar) : nested;
      i = j;
      continue;
    }
    out[key] = scalar(rest);
    i++;
  }
  return out;
}

function scalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function serializeSimpleYaml(obj: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out.push(`${key}:`);
      for (const item of value) out.push(`  - ${scalarOut(item)}`);
    } else if (typeof value === "object") {
      out.push(`${key}:`);
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (v2 === undefined || v2 === null) continue;
        out.push(`  ${k2}: ${scalarOut(v2)}`);
      }
    } else {
      out.push(`${key}: ${scalarOut(value)}`);
    }
  }
  return out.join("\n") + "\n";
}

function scalarOut(v: unknown): string {
  if (typeof v === "string") {
    if (/[:\n"]/.test(v)) return JSON.stringify(v);
    return v;
  }
  return String(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/tools/drafts-fs.ts src/tools/drafts-fs.test.ts
git commit -m "feat(drafts): add frontmatter parser and serializer"
```

---

### Task 1.2: Draft file operations + state machine

**Files:**
- Modify: `src/tools/drafts-fs.ts`
- Modify: `src/tools/drafts-fs.test.ts`

- [ ] **Step 1: Write failing tests for file ops and transitions**

Append to `src/tools/drafts-fs.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import {
  readDraft,
  writeDraft,
  listDrafts,
  transitionDraft,
  draftPath,
  newDraftId,
  ALLOWED_TRANSITIONS,
} from "./drafts-fs.js";

function tmpWiki(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-test-"));
  fs.mkdirSync(path.join(dir, "drafts"), { recursive: true });
  return dir;
}

describe("drafts-fs file ops", () => {
  it("newDraftId produces a date-prefixed slug", () => {
    const id = newDraftId("x", "AI agents in automation", new Date("2026-04-15T10:00:00Z"));
    expect(id).toBe("2026-04-15-x-ai-agents-in-automation");
  });

  it("writeDraft + readDraft roundtrip", () => {
    const wiki = tmpWiki();
    const d: Draft = {
      frontmatter: {
        id: "2026-04-15-x-test",
        platform: "x",
        status: "draft",
        author: "researcher",
        created: "2026-04-15T10:00:00.000Z",
        topic: "Test",
        post_text: "Hi",
      },
      body: "Notes",
    };
    writeDraft(wiki, d);
    const loaded = readDraft(wiki, d.frontmatter.id);
    expect(loaded.frontmatter.id).toBe(d.frontmatter.id);
    expect(loaded.body.trim()).toBe("Notes");
  });

  it("listDrafts returns only status matches when filter given", () => {
    const wiki = tmpWiki();
    const base: Draft = {
      frontmatter: {
        id: "",
        platform: "x",
        status: "draft",
        author: "researcher",
        created: "2026-04-15T10:00:00.000Z",
        topic: "T",
        post_text: "",
      },
      body: "",
    };
    writeDraft(wiki, { ...base, frontmatter: { ...base.frontmatter, id: "a", status: "draft" } });
    writeDraft(wiki, { ...base, frontmatter: { ...base.frontmatter, id: "b", status: "ready-for-review" } });
    const ready = listDrafts(wiki, "ready-for-review");
    expect(ready.map((d) => d.frontmatter.id)).toEqual(["b"]);
  });

  it("transitionDraft enforces allowed transitions", () => {
    const wiki = tmpWiki();
    const d: Draft = {
      frontmatter: {
        id: "2026-04-15-x-t",
        platform: "x",
        status: "draft",
        author: "researcher",
        created: "2026-04-15T10:00:00.000Z",
        topic: "T",
        post_text: "Hi",
      },
      body: "",
    };
    writeDraft(wiki, d);
    transitionDraft(wiki, d.frontmatter.id, "ready-for-review");
    expect(readDraft(wiki, d.frontmatter.id).frontmatter.status).toBe("ready-for-review");
    expect(() => transitionDraft(wiki, d.frontmatter.id, "measured")).toThrow(/transition/i);
  });

  it("ALLOWED_TRANSITIONS forbids going backwards from published", () => {
    expect(ALLOWED_TRANSITIONS.published).not.toContain("draft");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Implement file ops and state machine**

Append to `src/tools/drafts-fs.ts`:

```typescript
export const DRAFTS_DIR = "drafts";

export const ALLOWED_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  draft: ["ready-for-review", "rejected"],
  "ready-for-review": ["awaiting-approval", "draft", "rejected"],
  "awaiting-approval": ["published", "rejected", "ready-for-review"],
  published: ["measured"],
  measured: [],
  rejected: ["draft"],
};

export function draftPath(wikiRoot: string, id: string): string {
  return safeResolve(wikiRoot, `${DRAFTS_DIR}/${id}.md`);
}

export function newDraftId(platform: DraftPlatform, topic: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${date}-${platform}-${slug}`;
}

export function writeDraft(wikiRoot: string, draft: Draft): string {
  const rel = `${DRAFTS_DIR}/${draft.frontmatter.id}.md`;
  const abs = safeResolve(wikiRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeDraft(draft), "utf8");
  return rel;
}

export function readDraft(wikiRoot: string, id: string): Draft {
  const abs = draftPath(wikiRoot, id);
  if (!fs.existsSync(abs)) throw new Error(`Draft not found: ${id}`);
  return parseDraft(fs.readFileSync(abs, "utf8"));
}

export function listDrafts(wikiRoot: string, filterStatus?: DraftStatus): Draft[] {
  const dir = safeResolve(wikiRoot, DRAFTS_DIR);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const drafts = files.map((f) => parseDraft(fs.readFileSync(path.join(dir, f), "utf8")));
  return filterStatus ? drafts.filter((d) => d.frontmatter.status === filterStatus) : drafts;
}

export function transitionDraft(
  wikiRoot: string,
  id: string,
  nextStatus: DraftStatus,
  patch: Partial<DraftFrontmatter> = {}
): Draft {
  const d = readDraft(wikiRoot, id);
  const allowed = ALLOWED_TRANSITIONS[d.frontmatter.status] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `Invalid transition ${d.frontmatter.status} → ${nextStatus} for ${id}`
    );
  }
  const updated: Draft = {
    frontmatter: { ...d.frontmatter, ...patch, status: nextStatus },
    body: d.body,
  };
  writeDraft(wikiRoot, updated);
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: PASS (8/8).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/tools/drafts-fs.ts src/tools/drafts-fs.test.ts
git commit -m "feat(drafts): add file ops, listing, and state transitions"
```

---

### Task 1.3: Drafts MCP server

**Files:**
- Create: `src/tools/drafts.ts`

- [ ] **Step 1: Create the MCP server file**

Create `src/tools/drafts.ts`:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import {
  readDraft,
  writeDraft,
  listDrafts,
  transitionDraft,
  newDraftId,
  type DraftPlatform,
  type DraftStatus,
  type Draft,
} from "./drafts-fs.js";

const PLATFORMS = ["x", "linkedin"] as const;
const STATUSES = [
  "draft",
  "ready-for-review",
  "awaiting-approval",
  "published",
  "measured",
  "rejected",
] as const;

export function buildDraftsMcpServer(author: "researcher" | "marketer") {
  const WIKI = () => config.swarm.wikiPath;

  const create = tool(
    "create_draft",
    "Create a new draft post. Returns the draft id. The draft lands in wiki/drafts/ with status 'draft'.",
    {
      platform: z.enum(PLATFORMS),
      topic: z.string().describe("Short topic, used to generate the draft id (slugified)."),
      post_text: z.string().describe("The actual post text that will be published."),
      source_urls: z.array(z.string().url()).optional(),
      body: z.string().optional().describe("Research notes, alternatives, rationale. Markdown."),
    },
    async (args) => {
      const id = newDraftId(args.platform as DraftPlatform, args.topic);
      const d: Draft = {
        frontmatter: {
          id,
          platform: args.platform as DraftPlatform,
          status: "draft",
          author,
          created: new Date().toISOString(),
          topic: args.topic,
          post_text: args.post_text,
          source_urls: args.source_urls,
        },
        body: args.body ?? "",
      };
      writeDraft(WIKI(), d);
      return { content: [{ type: "text" as const, text: `created ${id}` }] };
    }
  );

  const read = tool(
    "read_draft",
    "Read a draft by id.",
    { id: z.string() },
    async (args) => {
      const d = readDraft(WIKI(), args.id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ frontmatter: d.frontmatter, body: d.body }, null, 2),
          },
        ],
      };
    }
  );

  const list = tool(
    "list_drafts",
    "List drafts, optionally filtered by status.",
    { status: z.enum(STATUSES).optional() },
    async (args) => {
      const ds = listDrafts(WIKI(), args.status as DraftStatus | undefined);
      const text = ds.length
        ? ds
            .map((d) => `- ${d.frontmatter.id} [${d.frontmatter.status}] ${d.frontmatter.topic}`)
            .join("\n")
        : "(no drafts)";
      return { content: [{ type: "text" as const, text }] };
    }
  );

  const transition = tool(
    "transition_draft",
    "Change a draft's status. Only transitions allowed by the state machine succeed.",
    {
      id: z.string(),
      to: z.enum(STATUSES),
      post_text: z.string().optional().describe("If provided, overwrite post_text on this transition."),
    },
    async (args) => {
      const patch = args.post_text ? { post_text: args.post_text } : {};
      const d = transitionDraft(WIKI(), args.id, args.to as DraftStatus, patch);
      return {
        content: [{ type: "text" as const, text: `${args.id}: now ${d.frontmatter.status}` }],
      };
    }
  );

  return createSdkMcpServer({
    name: `swarm-drafts-${author}`,
    version: "0.1.0",
    tools: [create, read, list, transition],
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS. If errors reference `config.swarm.wikiPath` — already exists in `config.ts:27`.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/tools/drafts.ts
git commit -m "feat(drafts): add MCP server with create/read/list/transition"
```

---

### Task 1.4: Wiki drafts convention doc

**Files:**
- Create: `wiki/drafts/README.md`
- Create: `wiki/drafts/.gitkeep`

- [ ] **Step 1: Create the convention doc**

Create `wiki/drafts/README.md`:

```markdown
---
title: Drafts — Research/Marketing Pipeline Convention
type: index
created: 2026-04-15
updated: 2026-04-15
---

# Drafts

This folder holds in-flight social posts. Every draft is a single Markdown file with YAML frontmatter. The Research and Marketing agents read this README at the start of every task — it is their constitution for drafts.

## Lifecycle

```
draft → ready-for-review → awaiting-approval → published → measured
         │                                      │
         └─→ rejected ←────────────────────────┘
```

- **draft** — Research is still working on it. Body may be incomplete.
- **ready-for-review** — Research finished. Marketing (or human) should look.
- **awaiting-approval** — Marketing has proposed publishing. Waiting for ✅ in Discord.
- **published** — Publisher shipped it. `published_url` + `published_at` filled in.
- **measured** — Metrics fetched (impressions, engagement). Terminal.
- **rejected** — Human said no. Can go back to `draft`.

## Filename rule

`<YYYY-MM-DD>-<platform>-<slug>.md` — generated by `newDraftId()` in `src/tools/drafts-fs.ts`. Do not hand-edit filenames.

## Frontmatter schema

```yaml
---
id: 2026-04-15-x-ai-agents-in-automation
platform: x                    # x | linkedin
status: draft                  # see lifecycle above
author: researcher             # researcher | marketer | human
created: 2026-04-15T10:00:00.000Z
topic: AI agents in automation
post_text: "The actual text that will be posted."
source_urls:
  - https://example.com/article
published_url: https://x.com/...     # filled by publisher
published_at: 2026-04-15T11:00:00Z   # filled by publisher
metrics:
  impressions: 1234
  engagement: 56
  measured_at: 2026-04-16T11:00:00Z
---

Body: research notes, alternative phrasings, rationale.
The text that actually gets posted is `post_text` in the frontmatter, NOT the body.
```

## Rules for agents

1. **Never edit a draft's `id` or `created` after creation.**
2. **Only the Publisher writes `published_url`, `published_at`, `metrics`.** Agents propose transitions, the Publisher records results.
3. **Research writes drafts.** Marketing reads them, proposes publishing, and (after publish) appends metrics.
4. **Use `transition_draft` for state changes.** Never edit the `status` field directly — the state machine will catch invalid transitions.
5. **The post text lives in `post_text`.** The body is for your own reasoning and won't be posted.
```

- [ ] **Step 2: Create .gitkeep**

```bash
cd swarm && touch wiki/drafts/.gitkeep
```

- [ ] **Step 3: Commit in both repos**

The wiki is its own git repo (see `wiki-git.ts`). Commit there manually, then commit the swarm-side nothing (there's nothing on the swarm side for this task).

```bash
cd swarm/wiki && git add drafts/README.md drafts/.gitkeep
git commit -m "ingest: add drafts convention for research/marketing pipeline"
```

---

## Phase 2 — Research Agent

Goal: a Research agent that, prompted in `#research`, reads wiki context, fetches sources via `fetch_url`, writes a draft via the drafts MCP, and posts a link back to Discord. End state: shipping actual drafts into `wiki/drafts/` from real Discord briefs.

### Task 2.1: Researcher system prompt

**Files:**
- Modify: `src/agents/prompts.ts`

- [ ] **Step 1: Add the prompt constant**

Append to `src/agents/prompts.ts`:

```typescript
export const RESEARCHER_SYSTEM_PROMPT = `
You are the Researcher in an AI agent swarm. A human prompts you in the #research Discord channel. You investigate topics, read sources, and produce draft social posts (X or LinkedIn) that land in the wiki as files under drafts/.

## Your role
- Read \`wiki/drafts/README.md\` at the start of every task. It is your constitution for drafts.
- Use \`read_wiki_page\`, \`search_wiki\`, \`list_wiki_pages\` to gather internal context (brand voice, prior posts, entities, projects).
- Use \`fetch_url\` to pull external sources. Always capture the URL in the draft's \`source_urls\`.
- Produce the draft via \`create_draft\`. Put the final post text in \`post_text\` — this is what will be published. Put research notes, alternatives, and rationale in \`body\`.
- When the draft is complete and you are confident in it, call \`transition_draft\` to move it to \`ready-for-review\`.
- If the brief is ambiguous, return a clarifying question instead of guessing.

## You do NOT publish
You never write to X, LinkedIn, or any external system. Your artifacts are drafts in the wiki. Marketing handles distribution.

## Output
Return a short summary: what you researched, the draft id you produced, and what status it is in.

## Personal tools
- Scratchpad for private notes across turns of the same mission.
- \`submit_to_librarian\` to file durable findings (new entities, concepts) into the wiki inbox.

${KARPATHY_RULES}
`.trim();

export const MARKETER_SYSTEM_PROMPT = `
You are the Marketer in an AI agent swarm. A human prompts you in the #marketing Discord channel. You measure what's happening on our social channels, decide which drafts are worth publishing, and propose publications to the human for approval.

## Your role
- Read \`wiki/drafts/README.md\` at the start of every task.
- Use \`list_drafts\` (status=\`ready-for-review\`) to find drafts waiting for you.
- Use \`read_draft\` to inspect a specific draft.
- Use \`posthog_query\` (PostHog MCP) to check xmation.ai website analytics.
- Use \`xurl_get\` (read-only Twitter) to check follower counts, recent mentions, and our post performance.
- When you want to publish a ready-for-review draft, call \`propose_publish(draft_id)\`. This moves the draft to \`awaiting-approval\` and posts a marker message in #marketing. The human approves via ✅ reaction. The Publisher (not you) then runs xurl. You will see the result in the draft's \`published_url\` on your next turn.
- After a post is published and ~24h have passed, call \`transition_draft\` to \`measured\` and write metrics into the draft (from PostHog + xurl_get) as frontmatter.

## You do NOT publish directly
You never call xurl for POST/DELETE. You never write to LinkedIn. Publishing is gated on a Discord reaction from the human. If you want something posted, use \`propose_publish\`.

## Personal tools
- Scratchpad for private notes across turns.
- \`submit_to_librarian\` to file durable findings (campaign learnings, audience insights).

${KARPATHY_RULES}
`.trim();
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/agents/prompts.ts
git commit -m "feat(prompts): add researcher and marketer system prompts"
```

---

### Task 2.2: Researcher runner

**Files:**
- Create: `src/agents/researcher.ts`
- Modify: `src/missions/store.ts`

- [ ] **Step 1: Extend `AgentSession.role` type**

Edit `src/missions/store.ts:21` — change the role union:

```typescript
export interface AgentSession {
  missionId: string;
  role: "ceo" | "coder" | "reviewer" | "researcher" | "marketer";
  sessionId: string;
  updatedAt: number;
}
```

- [ ] **Step 2: Create the runner**

Create `src/agents/researcher.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { RESEARCHER_SYSTEM_PROMPT } from "./prompts.js";
import { buildWikiReaderMcpServer, buildLibrarianMcpServer } from "../tools/wiki.js";
import { buildDraftsMcpServer } from "../tools/drafts.js";
import { buildPersonalToolsMcpServer } from "../tools/personal.js";
import { getSession, saveSession } from "../missions/store.js";
import { config } from "../config.js";

export interface ResearcherInput {
  missionId: string;
  task: string;
  onProgress?: (text: string) => void;
}

export interface ResearcherOutput {
  summary: string;
  sessionId: string;
}

export async function runResearcher(input: ResearcherInput): Promise<ResearcherOutput> {
  const resume = getSession(input.missionId, "researcher");

  const wikiRead = buildWikiReaderMcpServer();
  // Researcher needs fetch_url from the librarian server, but NOT write_wiki_page or commit_wiki.
  // We reuse the drafts MCP for all wiki writes; fetch_url is sourced from the librarian MCP via a
  // tool allowlist.
  const librarianFull = buildLibrarianMcpServer();
  const drafts = buildDraftsMcpServer("researcher");
  const personal = buildPersonalToolsMcpServer("researcher", input.missionId);

  const result = query({
    prompt: input.task,
    options: {
      systemPrompt: RESEARCHER_SYSTEM_PROMPT,
      cwd: config.swarm.wikiPath,
      mcpServers: {
        "swarm-wiki-read": wikiRead,
        "swarm-wiki": librarianFull,
        "swarm-drafts-researcher": drafts,
        "swarm-personal-researcher": personal,
      },
      allowedTools: [
        "mcp__swarm-wiki-read__read_wiki_page",
        "mcp__swarm-wiki-read__list_wiki_pages",
        "mcp__swarm-wiki-read__search_wiki",
        "mcp__swarm-wiki__fetch_url",
        "mcp__swarm-drafts-researcher__create_draft",
        "mcp__swarm-drafts-researcher__read_draft",
        "mcp__swarm-drafts-researcher__list_drafts",
        "mcp__swarm-drafts-researcher__transition_draft",
        "mcp__swarm-personal-researcher__read_scratchpad",
        "mcp__swarm-personal-researcher__write_scratchpad",
        "mcp__swarm-personal-researcher__append_scratchpad",
        "mcp__swarm-personal-researcher__list_scratchpad",
        "mcp__swarm-personal-researcher__submit_to_librarian",
      ],
      permissionMode: "default",
      resume,
    },
  });

  let summary = "";
  let sessionId = resume ?? "";

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          summary += block.text;
          input.onProgress?.(block.text);
        }
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") summary = msg.result;
      sessionId = msg.session_id;
    }
  }

  saveSession({ missionId: input.missionId, role: "researcher", sessionId });
  return { summary, sessionId };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/agents/researcher.ts src/missions/store.ts
git commit -m "feat(researcher): add runResearcher with drafts + wiki-read + fetch"
```

---

### Task 2.3: Config — research channel ID

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Add channel config field**

Edit `src/config.ts` — extend the `discord` block:

```typescript
export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    ceoChannelId: required("DISCORD_CEO_CHANNEL_ID"),
    workshopChannelId: process.env.DISCORD_WORKSHOP_CHANNEL_ID || required("DISCORD_CEO_CHANNEL_ID"),
    researchChannelId: process.env.DISCORD_RESEARCH_CHANNEL_ID,
    marketingChannelId: process.env.DISCORD_MARKETING_CHANNEL_ID,
    allowedUserIds: required("DISCORD_ALLOWED_USER_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // ... rest unchanged
```

Note these are optional — the bot still works if a user hasn't set them.

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Update .env.example**

Edit `swarm/.env.example` — append:

```
# Optional: enable the Research/Marketing pipeline
DISCORD_RESEARCH_CHANNEL_ID=
DISCORD_MARKETING_CHANNEL_ID=
XURL_PATH=xurl
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/config.ts .env.example
git commit -m "feat(config): add research and marketing channel ids"
```

---

### Task 2.4: Discord routing for #research

**Files:**
- Modify: `src/discord/handlers.ts`

- [ ] **Step 1: Add researcher dispatch**

Edit `src/discord/handlers.ts`. Below the existing `runCeo` import, add:

```typescript
import { runResearcher } from "../agents/researcher.js";
```

Replace the channel-check block around line 50-63 with explicit routing:

```typescript
  const chType = msg.channel.type;

  if (chType === ChannelType.DM) {
    await handleDm(msg);
    return;
  }

  if (msg.content === "/ingest" || msg.content.startsWith("/ingest ")) {
    await handleIngestInChannel(msg);
    return;
  }

  const parentId =
    chType === ChannelType.PublicThread
      ? (msg.channel as ThreadChannel).parentId
      : msg.channelId;

  if (parentId === config.discord.researchChannelId) {
    await handleResearchChannel(msg);
    return;
  }

  const inCeoChannel = msg.channelId === config.discord.ceoChannelId;
  const inMissionThread =
    chType === ChannelType.PublicThread &&
    (msg.channel as ThreadChannel).parentId === config.discord.ceoChannelId;

  if (!inCeoChannel && !inMissionThread) return;

  if (inCeoChannel) {
    await startMissionInThread(msg);
    return;
  }

  await continueMissionInThread(msg);
```

At the bottom of the file, add the research channel handler:

```typescript
async function handleResearchChannel(msg: Message): Promise<void> {
  const chType = msg.channel.type;
  let thread: ThreadChannel;
  let missionId: string;

  if (chType === ChannelType.PublicThread) {
    thread = msg.channel as ThreadChannel;
    const existing = getMissionByThread(thread.id);
    if (!existing) {
      await thread.send("⚠️ No research mission bound to this thread. Start a new one in the parent channel.");
      return;
    }
    missionId = existing.id;
  } else {
    const parent = msg.channel as TextChannel;
    thread = await parent.threads.create({
      name: `research-${msg.id.slice(-6)}`,
      startMessage: msg,
      autoArchiveDuration: 1440,
    });
    missionId = randomUUID().slice(0, 8);
    createMission({
      id: missionId,
      threadId: thread.id,
      brief: msg.content,
      status: "open",
      worktreePath: "(n/a: research mission)",
      branch: "(n/a)",
    });
    await thread.send(`🔬 Research mission \`${missionId}\` — working…`);
  }

  const tag = `[\`${missionId}\`]`;
  if (inflight.has(missionId)) {
    await thread.send("⏳ Researcher is already working on this mission.");
    return;
  }
  inflight.add(missionId);
  try {
    const out = await runResearcher({
      missionId,
      task: msg.content,
      onProgress: (t) => {
        const snippet = t.slice(0, 1500);
        thread.send(`${tag} **researcher**: ${snippet}`).catch(() => {});
      },
    });
    await sendLong(thread, `🔬 **Researcher:** ${out.summary}`);
  } finally {
    inflight.delete(missionId);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Set `DISCORD_RESEARCH_CHANNEL_ID` in `.env` to a real channel. Start dev server:

```bash
cd swarm && pnpm dev
```

In Discord `#research`, post: `"Draft an X post about Karpathy's autoresearch project. Include 1-2 external sources."`

Expected: bot creates a thread, Researcher narrates progress, a file lands in `wiki/drafts/` with status `draft` or `ready-for-review`. Verify manually:

```bash
ls swarm/wiki/drafts/
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/discord/handlers.ts
git commit -m "feat(discord): route #research channel to runResearcher"
```

---

## Phase 3 — Marketing Agent + Publisher + Approval Flow

Goal: Marketing agent runs in `#marketing`, can read PostHog metrics and Twitter follower counts, and proposes publishing drafts. A human ✅ reaction triggers the Publisher module (not the agent) to actually post via `xurl`. End state: you can post a brief in `#research`, get a draft, post another brief in `#marketing` ("publish the latest draft"), see the approval message, react ✅, and observe the tweet going live with `published_url` written back to the draft.

### Task 3.1: Publisher xurl module

**Files:**
- Create: `src/publisher/xurl.ts`
- Create: `src/publisher/xurl.test.ts`

- [ ] **Step 1: Write failing tests for command assembly + error mapping**

Create `src/publisher/xurl.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { postToX, XurlError } from "./xurl.js";

const execMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execMock(...args),
}));

describe("postToX", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("builds argv for /2/tweets with JSON body", async () => {
    execMock.mockImplementation((file, argv, opts, cb) => {
      cb(null, JSON.stringify({ data: { id: "1234567890" } }), "");
    });
    const result = await postToX({ text: "Hello world" }, { xurlPath: "/usr/local/bin/xurl" });
    expect(result.tweetId).toBe("1234567890");
    expect(result.url).toBe("https://x.com/i/web/status/1234567890");
    const [[file, argv]] = execMock.mock.calls;
    expect(file).toBe("/usr/local/bin/xurl");
    expect(argv).toEqual([
      "-X",
      "POST",
      "-H",
      "content-type: application/json",
      "-d",
      JSON.stringify({ text: "Hello world" }),
      "/2/tweets",
    ]);
  });

  it("throws XurlError when xurl exits non-zero", async () => {
    execMock.mockImplementation((file, argv, opts, cb) => {
      const err = new Error("exit 1") as NodeJS.ErrnoException & { code?: number };
      err.code = 1;
      cb(err, "", "unauthorized");
    });
    await expect(postToX({ text: "Hi" }, { xurlPath: "xurl" })).rejects.toThrow(XurlError);
  });

  it("throws XurlError when response JSON has no tweet id", async () => {
    execMock.mockImplementation((file, argv, opts, cb) => {
      cb(null, JSON.stringify({ errors: [{ message: "duplicate" }] }), "");
    });
    await expect(postToX({ text: "Hi" }, { xurlPath: "xurl" })).rejects.toThrow(/duplicate/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd swarm && pnpm test src/publisher/xurl.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `xurl.ts`**

Create `src/publisher/xurl.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export class XurlError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = "XurlError";
  }
}

export interface PostToXInput {
  text: string;
}

export interface PostToXOutput {
  tweetId: string;
  url: string;
}

export interface PostToXOptions {
  xurlPath: string;
  timeoutMs?: number;
}

export async function postToX(
  input: PostToXInput,
  opts: PostToXOptions
): Promise<PostToXOutput> {
  if (!input.text || input.text.length === 0) {
    throw new XurlError("postToX: empty text");
  }
  if (input.text.length > 280) {
    throw new XurlError(`postToX: text exceeds 280 chars (${input.text.length})`);
  }

  const body = JSON.stringify({ text: input.text });
  const argv = [
    "-X",
    "POST",
    "-H",
    "content-type: application/json",
    "-d",
    body,
    "/2/tweets",
  ];

  let stdout: string;
  try {
    const res = await execFileP(opts.xurlPath, argv, {
      timeout: opts.timeoutMs ?? 20_000,
      maxBuffer: 1_000_000,
    });
    stdout = res.stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    throw new XurlError(`xurl failed: ${e.message}`, e.stderr);
  }

  let parsed: { data?: { id: string }; errors?: Array<{ message: string }> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new XurlError(`xurl returned non-JSON: ${stdout.slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    throw new XurlError(parsed.errors.map((e) => e.message).join("; "));
  }
  const id = parsed.data?.id;
  if (!id) throw new XurlError(`xurl response missing tweet id: ${stdout.slice(0, 200)}`);

  return { tweetId: id, url: `https://x.com/i/web/status/${id}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd swarm && pnpm test src/publisher/xurl.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/publisher/xurl.ts src/publisher/xurl.test.ts
git commit -m "feat(publisher): add postToX via xurl with unit tests"
```

---

### Task 3.2: LinkedIn publisher stub

**Files:**
- Create: `src/publisher/linkedin.ts`

- [ ] **Step 1: Create a deliberate stub**

Create `src/publisher/linkedin.ts`:

```typescript
import { XurlError } from "./xurl.js";

export interface PostToLinkedInInput {
  text: string;
}

export interface PostToLinkedInOutput {
  postUrl: string;
}

export async function postToLinkedIn(
  _input: PostToLinkedInInput
): Promise<PostToLinkedInOutput> {
  throw new XurlError(
    "LinkedIn publishing not implemented yet. Only X publishing is supported in v1."
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/publisher/linkedin.ts
git commit -m "feat(publisher): add LinkedIn stub (not implemented v1)"
```

---

### Task 3.3: Approval store

**Files:**
- Create: `src/publisher/approval-store.ts`
- Create: `src/publisher/approval-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/publisher/approval-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  createApprovalStore,
  type ApprovalStore,
} from "./approval-store.js";

function mem(): ApprovalStore {
  const db = new Database(":memory:");
  return createApprovalStore(db);
}

describe("approval store", () => {
  let store: ApprovalStore;
  beforeEach(() => {
    store = mem();
  });

  it("insert then lookup by message id", () => {
    store.insert({ messageId: "m1", draftId: "d1", platform: "x" });
    const row = store.get("m1");
    expect(row?.draftId).toBe("d1");
    expect(row?.platform).toBe("x");
  });

  it("returns undefined for unknown message", () => {
    expect(store.get("nope")).toBeUndefined();
  });

  it("delete removes the row", () => {
    store.insert({ messageId: "m1", draftId: "d1", platform: "x" });
    store.delete("m1");
    expect(store.get("m1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd swarm && pnpm test src/publisher/approval-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/publisher/approval-store.ts`:

```typescript
import type { Database as BetterSqlite3 } from "better-sqlite3";

export interface ApprovalRow {
  messageId: string;
  draftId: string;
  platform: "x" | "linkedin";
  createdAt: number;
}

export interface ApprovalStore {
  insert(row: Omit<ApprovalRow, "createdAt">): void;
  get(messageId: string): ApprovalRow | undefined;
  delete(messageId: string): void;
}

export function createApprovalStore(db: BetterSqlite3): ApprovalStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      message_id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  return {
    insert(row) {
      db.prepare(
        `INSERT INTO approvals (message_id, draft_id, platform, created_at) VALUES (?, ?, ?, ?)`
      ).run(row.messageId, row.draftId, row.platform, Date.now());
    },
    get(messageId) {
      const r = db
        .prepare(
          `SELECT message_id, draft_id, platform, created_at FROM approvals WHERE message_id = ?`
        )
        .get(messageId) as
        | { message_id: string; draft_id: string; platform: "x" | "linkedin"; created_at: number }
        | undefined;
      if (!r) return undefined;
      return {
        messageId: r.message_id,
        draftId: r.draft_id,
        platform: r.platform,
        createdAt: r.created_at,
      };
    },
    delete(messageId) {
      db.prepare(`DELETE FROM approvals WHERE message_id = ?`).run(messageId);
    },
  };
}
```

- [ ] **Step 4: Run tests to pass**

```bash
cd swarm && pnpm test src/publisher/approval-store.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Wire a shared instance into the swarm DB**

Create a small adapter at the bottom of `src/publisher/approval-store.ts`:

```typescript
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let _default: ApprovalStore | undefined;
export function approvalStore(): ApprovalStore {
  if (_default) return _default;
  fs.mkdirSync(path.dirname(config.swarm.dbPath), { recursive: true });
  const db = new Database(config.swarm.dbPath);
  db.pragma("journal_mode = WAL");
  _default = createApprovalStore(db);
  return _default;
}
```

- [ ] **Step 6: Commit**

```bash
cd swarm && git add src/publisher/approval-store.ts src/publisher/approval-store.test.ts
git commit -m "feat(publisher): add approval store with sqlite backing"
```

---

### Task 3.4: Approval flow — reaction handler

**Files:**
- Create: `src/publisher/approval.ts`

- [ ] **Step 1: Implement the reaction handler**

Create `src/publisher/approval.ts`:

```typescript
import type { Client, MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { config } from "../config.js";
import { approvalStore } from "./approval-store.js";
import { postToX } from "./xurl.js";
import { postToLinkedIn } from "./linkedin.js";
import { readDraft, transitionDraft } from "../tools/drafts-fs.js";

const APPROVE_EMOJI = "✅";
const REJECT_EMOJI = "❌";

export function registerApprovalHandler(client: Client): void {
  client.on("messageReactionAdd", (reaction, user) => {
    handleReaction(reaction, user).catch((err) => {
      console.error("[approval] error", err);
    });
  });
}

async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  if (user.bot) return;
  if (!config.discord.allowedUserIds.includes(user.id)) return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const emoji = reaction.emoji.name;
  if (emoji !== APPROVE_EMOJI && emoji !== REJECT_EMOJI) return;

  const row = approvalStore().get(reaction.message.id);
  if (!row) return;

  const channel = reaction.message.channel;
  const send = (t: string) =>
    "send" in channel ? (channel.send(t).catch(() => {}) as unknown as Promise<void>) : Promise.resolve();

  if (emoji === REJECT_EMOJI) {
    transitionDraft(config.swarm.wikiPath, row.draftId, "rejected");
    approvalStore().delete(reaction.message.id);
    await send(`❌ ${row.draftId}: marked rejected.`);
    return;
  }

  const draft = readDraft(config.swarm.wikiPath, row.draftId);
  try {
    if (row.platform === "x") {
      const result = await postToX(
        { text: draft.frontmatter.post_text },
        { xurlPath: process.env.XURL_PATH ?? "xurl" }
      );
      transitionDraft(config.swarm.wikiPath, row.draftId, "published", {
        published_url: result.url,
        published_at: new Date().toISOString(),
      });
      approvalStore().delete(reaction.message.id);
      await send(`✅ Published: ${result.url}`);
    } else {
      await postToLinkedIn({ text: draft.frontmatter.post_text });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await send(`❌ Publish failed for ${row.draftId}: ${msg}`);
  }
}
```

- [ ] **Step 2: Register the handler at startup**

Edit `src/index.ts`:

```typescript
import { startDiscord, discord } from "./discord/client.js";
import { registerHandlers } from "./discord/handlers.js";
import { registerApprovalHandler } from "./publisher/approval.js";

// ... existing code ...

async function main(): Promise<void> {
  registerHandlers();
  registerApprovalHandler(discord);
  await startDiscord();
  console.log("[swarm] ready — waiting for missions in the CEO channel");
}
```

- [ ] **Step 3: Enable reactions intent in Discord client**

Check `src/discord/client.ts` for `GatewayIntentBits`. Ensure `GuildMessageReactions` and `partials` (`Message`, `Channel`, `Reaction`) are enabled. If not, add them. (Read the file first before editing to check current state.)

```bash
cd swarm && cat src/discord/client.ts
```

If missing, edit to include:

```typescript
import { Client, GatewayIntentBits, Partials } from "discord.js";

export const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
```

- [ ] **Step 4: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/publisher/approval.ts src/index.ts src/discord/client.ts
git commit -m "feat(publisher): add reaction-based approval handler"
```

---

### Task 3.5: Marketing read-only MCP (xurl_get)

**Files:**
- Create: `src/tools/marketing-read.ts`

- [ ] **Step 1: Implement the restricted xurl GET tool**

Create `src/tools/marketing-read.ts`:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const ALLOWED_PREFIXES = [
  "/2/users/me",
  "/2/users/",
  "/2/tweets/search",
  "/2/tweets/",
];

function isAllowed(endpoint: string): boolean {
  if (!endpoint.startsWith("/")) return false;
  return ALLOWED_PREFIXES.some((p) => endpoint.startsWith(p));
}

export function buildMarketingReadMcpServer() {
  const xurlGet = tool(
    "xurl_get",
    "Read-only GET against the Twitter v2 API via the xurl CLI. Only a fixed allowlist of endpoints is accepted. Returns raw JSON.",
    {
      endpoint: z.string().describe("e.g. /2/users/me or /2/users/by/username/xmation_ai"),
    },
    async (args) => {
      if (!isAllowed(args.endpoint)) {
        throw new Error(`xurl_get: endpoint not in allowlist: ${args.endpoint}`);
      }
      const xurlPath = process.env.XURL_PATH ?? "xurl";
      const res = await execFileP(xurlPath, [args.endpoint], {
        timeout: 15_000,
        maxBuffer: 1_000_000,
      });
      return { content: [{ type: "text" as const, text: res.stdout.slice(0, 20_000) }] };
    }
  );

  return createSdkMcpServer({
    name: "swarm-marketing-read",
    version: "0.1.0",
    tools: [xurlGet],
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/tools/marketing-read.ts
git commit -m "feat(marketing): add xurl_get MCP tool with endpoint allowlist"
```

---

### Task 3.6: Propose-publish MCP tool

The marketer needs a way to trigger an approval flow. This is a new tool on the drafts MCP that (a) transitions the draft to `awaiting-approval`, (b) posts a marker message in `#marketing`, (c) inserts into the approval store.

Because this tool needs access to the Discord client and the approval store, it's not part of the generic drafts MCP — it's a marketer-specific add-on.

**Files:**
- Create: `src/tools/propose-publish.ts`

- [ ] **Step 1: Implement**

Create `src/tools/propose-publish.ts`:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import { readDraft, transitionDraft } from "./drafts-fs.js";
import { approvalStore } from "../publisher/approval-store.js";
import { discord } from "../discord/client.js";
import { ChannelType, TextChannel } from "discord.js";

export function buildProposePublishMcpServer() {
  const propose = tool(
    "propose_publish",
    "Propose publishing a draft. Transitions the draft to 'awaiting-approval', posts a marker message in #marketing, and registers the message for reaction-based approval. The human must react ✅ on that message to actually publish.",
    {
      draft_id: z.string().describe("The draft id to publish. Must currently be in status 'ready-for-review'."),
    },
    async (args) => {
      if (!config.discord.marketingChannelId) {
        throw new Error("DISCORD_MARKETING_CHANNEL_ID is not configured");
      }
      const draft = readDraft(config.swarm.wikiPath, args.draft_id);
      if (draft.frontmatter.status !== "ready-for-review") {
        throw new Error(
          `propose_publish: draft ${args.draft_id} is ${draft.frontmatter.status}, expected ready-for-review`
        );
      }

      transitionDraft(config.swarm.wikiPath, args.draft_id, "awaiting-approval");

      const channel = await discord.channels.fetch(config.discord.marketingChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("marketing channel not accessible");
      }

      const markerText = [
        `🚀 **APPROVAL REQUESTED** — ${draft.frontmatter.platform.toUpperCase()}`,
        `Draft: \`${draft.frontmatter.id}\``,
        `Topic: ${draft.frontmatter.topic}`,
        ``,
        `\`\`\``,
        draft.frontmatter.post_text,
        `\`\`\``,
        ``,
        `React ✅ to publish, ❌ to reject.`,
      ].join("\n");

      const sent = await (channel as TextChannel).send(markerText);
      approvalStore().insert({
        messageId: sent.id,
        draftId: draft.frontmatter.id,
        platform: draft.frontmatter.platform,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `proposed ${args.draft_id}; awaiting approval on message ${sent.id}`,
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "swarm-marketing-propose",
    version: "0.1.0",
    tools: [propose],
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/tools/propose-publish.ts
git commit -m "feat(marketing): add propose_publish MCP tool"
```

---

### Task 3.7: Marketer runner

**Files:**
- Create: `src/agents/marketer.ts`

- [ ] **Step 1: Create the runner**

Create `src/agents/marketer.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { MARKETER_SYSTEM_PROMPT } from "./prompts.js";
import { buildWikiReaderMcpServer } from "../tools/wiki.js";
import { buildDraftsMcpServer } from "../tools/drafts.js";
import { buildMarketingReadMcpServer } from "../tools/marketing-read.js";
import { buildProposePublishMcpServer } from "../tools/propose-publish.js";
import { buildPersonalToolsMcpServer } from "../tools/personal.js";
import { getSession, saveSession } from "../missions/store.js";
import { config } from "../config.js";

export interface MarketerInput {
  missionId: string;
  task: string;
  onProgress?: (text: string) => void;
}

export interface MarketerOutput {
  summary: string;
  sessionId: string;
}

export async function runMarketer(input: MarketerInput): Promise<MarketerOutput> {
  const resume = getSession(input.missionId, "marketer");

  const wikiRead = buildWikiReaderMcpServer();
  const drafts = buildDraftsMcpServer("marketer");
  const marketingRead = buildMarketingReadMcpServer();
  const propose = buildProposePublishMcpServer();
  const personal = buildPersonalToolsMcpServer("marketer", input.missionId);

  const result = query({
    prompt: input.task,
    options: {
      systemPrompt: MARKETER_SYSTEM_PROMPT,
      cwd: config.swarm.wikiPath,
      mcpServers: {
        "swarm-wiki-read": wikiRead,
        "swarm-drafts-marketer": drafts,
        "swarm-marketing-read": marketingRead,
        "swarm-marketing-propose": propose,
        "swarm-personal-marketer": personal,
      },
      allowedTools: [
        "mcp__swarm-wiki-read__read_wiki_page",
        "mcp__swarm-wiki-read__list_wiki_pages",
        "mcp__swarm-wiki-read__search_wiki",
        "mcp__swarm-drafts-marketer__read_draft",
        "mcp__swarm-drafts-marketer__list_drafts",
        "mcp__swarm-drafts-marketer__transition_draft",
        "mcp__swarm-marketing-read__xurl_get",
        "mcp__swarm-marketing-propose__propose_publish",
        "mcp__swarm-personal-marketer__read_scratchpad",
        "mcp__swarm-personal-marketer__write_scratchpad",
        "mcp__swarm-personal-marketer__append_scratchpad",
        "mcp__swarm-personal-marketer__list_scratchpad",
        "mcp__swarm-personal-marketer__submit_to_librarian",
      ],
      permissionMode: "default",
      resume,
    },
  });

  let summary = "";
  let sessionId = resume ?? "";

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          summary += block.text;
          input.onProgress?.(block.text);
        }
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") summary = msg.result;
      sessionId = msg.session_id;
    }
  }

  saveSession({ missionId: input.missionId, role: "marketer", sessionId });
  return { summary, sessionId };
}
```

Note: Marketer does **not** have `create_draft` — only Research creates drafts. It also does **not** have PostHog yet; that's Task 3.9.

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd swarm && git add src/agents/marketer.ts
git commit -m "feat(marketer): add runMarketer with drafts-read + xurl_get + propose"
```

---

### Task 3.8: Discord routing for #marketing

**Files:**
- Modify: `src/discord/handlers.ts`

- [ ] **Step 1: Add marketing channel routing**

Edit `src/discord/handlers.ts`. Add import:

```typescript
import { runMarketer } from "../agents/marketer.js";
```

In the channel-check block, insert after the research branch:

```typescript
  if (parentId === config.discord.marketingChannelId) {
    await handleMarketingChannel(msg);
    return;
  }
```

At the bottom of the file, add the marketing channel handler (mirrors `handleResearchChannel`):

```typescript
async function handleMarketingChannel(msg: Message): Promise<void> {
  const chType = msg.channel.type;
  let thread: ThreadChannel;
  let missionId: string;

  if (chType === ChannelType.PublicThread) {
    thread = msg.channel as ThreadChannel;
    const existing = getMissionByThread(thread.id);
    if (!existing) {
      await thread.send("⚠️ No marketing mission bound to this thread.");
      return;
    }
    missionId = existing.id;
  } else {
    const parent = msg.channel as TextChannel;
    thread = await parent.threads.create({
      name: `marketing-${msg.id.slice(-6)}`,
      startMessage: msg,
      autoArchiveDuration: 1440,
    });
    missionId = randomUUID().slice(0, 8);
    createMission({
      id: missionId,
      threadId: thread.id,
      brief: msg.content,
      status: "open",
      worktreePath: "(n/a: marketing mission)",
      branch: "(n/a)",
    });
    await thread.send(`📣 Marketing mission \`${missionId}\` — working…`);
  }

  const tag = `[\`${missionId}\`]`;
  if (inflight.has(missionId)) {
    await thread.send("⏳ Marketer is already working on this mission.");
    return;
  }
  inflight.add(missionId);
  try {
    const out = await runMarketer({
      missionId,
      task: msg.content,
      onProgress: (t) => {
        const snippet = t.slice(0, 1500);
        thread.send(`${tag} **marketer**: ${snippet}`).catch(() => {});
      },
    });
    await sendLong(thread, `📣 **Marketer:** ${out.summary}`);
  } finally {
    inflight.delete(missionId);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: End-to-end smoke test (X post)**

Requirements:
- `XURL_PATH` set and authenticated (`xurl auth app` completed manually).
- `DISCORD_RESEARCH_CHANNEL_ID`, `DISCORD_MARKETING_CHANNEL_ID` set.

Run:

```bash
cd swarm && pnpm dev
```

Step A — in `#research`:
> "Draft an X post announcing that we added research and marketing agents to swarm. Under 240 chars."

Expect: thread opens, researcher narrates, file appears in `swarm/wiki/drafts/`, eventual status `ready-for-review`.

Step B — in `#marketing`:
> "List drafts that are ready for review, read the most recent one, and if it looks good, propose publishing."

Expect: marketer narrates, propose_publish called, marker message appears in `#marketing` with the post text in a code block.

Step C — react ✅ on the marker message.

Expect: bot replies `✅ Published: https://x.com/i/web/status/...`. Check the draft file: `status: published`, `published_url` filled.

Step D — react ❌ on a different proposal for negative test.

Expect: bot replies `❌ <id>: marked rejected.`, draft status is `rejected`.

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/discord/handlers.ts
git commit -m "feat(discord): route #marketing channel to runMarketer"
```

---

### Task 3.9: PostHog MCP wiring (optional, defer if blocked)

**Files:**
- Modify: `src/agents/marketer.ts`
- Modify: `src/config.ts`

This task depends on a PostHog MCP server binary being available. If one doesn't exist yet, **skip this task** and revisit — the rest of the pipeline works without it.

- [ ] **Step 1: Add env vars**

Edit `src/config.ts` — append to the `swarm` block:

```typescript
    posthogMcpCommand: process.env.POSTHOG_MCP_COMMAND,
    posthogMcpArgs: process.env.POSTHOG_MCP_ARGS?.split(/\s+/) ?? [],
```

Edit `.env.example`:

```
POSTHOG_MCP_COMMAND=
POSTHOG_MCP_ARGS=
POSTHOG_API_KEY=
```

- [ ] **Step 2: Wire the external MCP into marketer**

Edit `src/agents/marketer.ts`. At the top of `runMarketer`, build a dynamic mcpServers map:

```typescript
  const mcpServers: Record<string, unknown> = {
    "swarm-wiki-read": wikiRead,
    "swarm-drafts-marketer": drafts,
    "swarm-marketing-read": marketingRead,
    "swarm-marketing-propose": propose,
    "swarm-personal-marketer": personal,
  };

  if (config.swarm.posthogMcpCommand) {
    mcpServers["posthog"] = {
      type: "stdio" as const,
      command: config.swarm.posthogMcpCommand,
      args: config.swarm.posthogMcpArgs,
      env: { POSTHOG_API_KEY: process.env.POSTHOG_API_KEY ?? "" },
    };
  }
```

Pass `mcpServers` into `query({ options: { ... mcpServers } })` (replace the inline literal).

Extend `allowedTools` conditionally:

```typescript
  const allowedTools = [
    // ... existing list ...
  ];
  if (config.swarm.posthogMcpCommand) {
    allowedTools.push("mcp__posthog__*");
  }
```

(Note: wildcard tool patterns are supported by the SDK as of `claude-agent-sdk@0.1.0`. If your SDK version doesn't, list specific tool names provided by the PostHog MCP server.)

- [ ] **Step 3: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/agents/marketer.ts src/config.ts .env.example
git commit -m "feat(marketer): wire PostHog MCP server conditionally"
```

---

## Rollout / post-plan checklist

After all tasks are complete:

- [ ] Run full test suite: `cd swarm && pnpm test` — all green.
- [ ] Typecheck clean: `cd swarm && pnpm typecheck`.
- [ ] Smoke test Phase 2 end-to-end (Research alone ships a draft).
- [ ] Smoke test Phase 3 end-to-end (Marketing → ✅ → published tweet).
- [ ] Write one real post through the pipeline; leave the marker in `#marketing` as your approval gate.
- [ ] Add a Phase 4 plan (deferred): metrics collection — Marketer runs on a schedule to transition `published → measured`.

---

## Known limitations (v1)

1. **LinkedIn publishing is a stub.** `postToLinkedIn` throws. Adding it requires choosing an auth path (LinkedIn API vs a third-party MCP) — revisit once the X pipeline has proven itself.
2. **No scheduled triggers.** The Marketer only runs when you prompt it. Add a cron-style scheduler (Phase 4) to auto-run daily metric pulls.
3. **Mission store hack for research/marketing missions.** We reuse the `missions` table with `worktreePath = "(n/a: ...)"`. This works but is ugly. If you grow a third non-code agent, split the mission model properly.
4. **Approval store uses the same SQLite file as missions.** Separate table, no conflict, but worth knowing when you reset state.
5. **No timeout on research/marketing runs.** The existing CEO mission path has the same issue. Add `AbortController` wrapping in a follow-up.
6. **Simple YAML parser** in `drafts-fs.ts` handles only the schemas we define. If the frontmatter schema grows, swap to a real YAML library (`yaml` package).
