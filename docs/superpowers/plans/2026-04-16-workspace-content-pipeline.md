# Workspace-Based Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an agent workspace system where you "hire" agents by copying role files from `agency-agents/` into per-agent workspace directories. Then hire two agents — a Research agent and a Marketing agent — that run an end-to-end X/LinkedIn content pipeline. Agents use **native tools** (Read/Write/Edit/Glob/Grep) on the wiki, with MCP only for security boundaries (xurl, propose_publish). Behavior lives in **markdown skill files**, not TypeScript.

**Architecture:**
- Each agent is a directory under `swarm/agents/<id>/` with a `role.md` (copied from `agency-agents/`), `agent.json` (config), `CLAUDE.md` (procedures), and `memory/`+`scratchpad/` dirs.
- A generic `runAgent(agentId, task)` replaces per-role runners. It reads the workspace, composes a layered system prompt, and mounts only the tools listed in `agent.json`.
- Two Discord department channels (`#research`, `#marketing`), routed by channel ID → department → agent lookup.
- Drafts live in `wiki/drafts/` as plain Markdown. Agents use native Write/Edit to create/transition them. A `drafts-fs.ts` library powers the Publisher module (not the agents).
- Publishing is gated by Discord ✅ reaction → Publisher module runs `xurl` → result written back to draft. Agents never touch external systems.

**Tech Stack:** Existing: TypeScript, `@anthropic-ai/claude-agent-sdk`, `discord.js`, `better-sqlite3`, `simple-git`, `vitest`. External: `xurl` CLI (X/Twitter OAuth1), agency-agents role library.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/agents/agent-config.ts` | `AgentConfig` type, JSON schema validator, config loader |
| `src/agents/registry.ts` | Scans `agents/*/agent.json`, builds department→agent map |
| `src/agents/compose-prompt.ts` | Layers role.md + shared skills + agent CLAUDE.md + Karpathy rules → system prompt |
| `src/agents/runner.ts` | Generic `runAgent(agentId, task)` — replaces per-role runners for non-code agents |
| `src/agents/hire.ts` | CLI script: scaffold workspace, copy role file, generate config |
| `src/tools/drafts-fs.ts` | Parse/serialize draft frontmatter, state transitions (used by Publisher, not agents) |
| `src/tools/drafts-fs.test.ts` | Unit tests: roundtrip, state machine |
| `src/tools/marketing-read.ts` | MCP server: `xurl_get` with endpoint allowlist |
| `src/tools/propose-publish.ts` | MCP server: atomic propose → transition + Discord marker + SQLite insert |
| `src/publisher/xurl.ts` | Shell out to `xurl` for X posts |
| `src/publisher/xurl.test.ts` | Unit tests: argv assembly, error mapping |
| `src/publisher/approval-store.ts` | SQLite table: approvals(message_id, draft_path, platform) |
| `src/publisher/approval-store.test.ts` | Unit tests |
| `src/publisher/approval.ts` | Discord reaction handler: ✅ → publish, ❌ → reject |
| `skills/shared/wiki-conventions.md` | Shared across all agents: wiki layout, drafts lifecycle, frontmatter schema |
| `agents/x-researcher/role.md` | Copied from `agency-agents/marketing/marketing-content-creator.md` |
| `agents/x-researcher/agent.json` | Config for research agent |
| `agents/x-researcher/CLAUDE.md` | Research-specific procedures |
| `agents/x-marketer/role.md` | Copied from `agency-agents/marketing/marketing-twitter-engager.md` |
| `agents/x-marketer/agent.json` | Config for marketing agent |
| `agents/x-marketer/CLAUDE.md` | Marketing-specific procedures |
| `wiki/drafts/README.md` | Drafts convention doc for agents to read |

### Modified files

| File | Change |
|---|---|
| `src/config.ts` | Add department channel map, xurl path |
| `src/discord/handlers.ts` | Department channel routing → registry → `runAgent` |
| `src/discord/client.ts` | Add `GuildMessageReactions` intent + `Reaction` partial |
| `src/index.ts` | Register approval handler, init registry |
| `src/missions/store.ts` | Extend `AgentSession.role` to `string` (dynamic agent IDs) |
| `.env.example` | Add department channel IDs, XURL_PATH |
| `package.json` | Add `hire` script |

---

## Phase 0 — Agent Workspace Infrastructure

Goal: build the hire/registry/runner system. No agents are hired yet. End state: `pnpm hire` scaffolds a workspace, `runAgent()` can execute any agent, registry maps departments to agents.

### Task 0.1: AgentConfig type + validator

**Files:**
- Create: `src/agents/agent-config.ts`

- [ ] **Step 1: Write the failing test**

Create `src/agents/agent-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseAgentConfig, type AgentConfig } from "./agent-config.js";

describe("parseAgentConfig", () => {
  it("parses a valid config", () => {
    const raw = {
      id: "x-researcher",
      department: "research",
      model: "claude-sonnet-4-6",
      nativeTools: ["Read", "Write", "Edit", "Glob", "Grep"],
      mcpTools: ["fetch_url", "submit_to_librarian"],
      created: "2026-04-16T00:00:00Z",
    };
    const c = parseAgentConfig(raw);
    expect(c.id).toBe("x-researcher");
    expect(c.department).toBe("research");
    expect(c.nativeTools).toContain("Write");
  });

  it("rejects config missing id", () => {
    expect(() => parseAgentConfig({ department: "research" })).toThrow(/id/i);
  });

  it("rejects config with unknown native tool", () => {
    expect(() =>
      parseAgentConfig({
        id: "x",
        department: "research",
        nativeTools: ["Delete"],
        mcpTools: [],
      })
    ).toThrow(/Delete/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd swarm && pnpm test src/agents/agent-config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/agents/agent-config.ts`:

```typescript
const VALID_NATIVE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
] as const;

export type NativeTool = (typeof VALID_NATIVE_TOOLS)[number];

export interface AgentConfig {
  id: string;
  department: string;
  model: string;
  nativeTools: NativeTool[];
  mcpTools: string[];
  created: string;
}

export function parseAgentConfig(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== "object") throw new Error("AgentConfig must be an object");
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== "string" || !r.id) throw new Error("AgentConfig: id is required");
  if (typeof r.department !== "string" || !r.department) throw new Error("AgentConfig: department is required");

  const model = typeof r.model === "string" ? r.model : "claude-sonnet-4-6";
  const nativeTools = Array.isArray(r.nativeTools) ? (r.nativeTools as string[]) : ["Read", "Glob", "Grep"];
  const mcpTools = Array.isArray(r.mcpTools) ? (r.mcpTools as string[]) : [];
  const created = typeof r.created === "string" ? r.created : new Date().toISOString();

  for (const t of nativeTools) {
    if (!(VALID_NATIVE_TOOLS as readonly string[]).includes(t)) {
      throw new Error(`AgentConfig: unknown native tool: ${t}`);
    }
  }

  return { id: r.id, department: r.department, model, nativeTools: nativeTools as NativeTool[], mcpTools, created };
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/agents/agent-config.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/agents/agent-config.ts src/agents/agent-config.test.ts
git commit -m "feat(workspace): add AgentConfig type and validator"
```

---

### Task 0.2: Registry

**Files:**
- Create: `src/agents/registry.ts`

- [ ] **Step 1: Write failing test**

Create `src/agents/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRegistry } from "./registry.js";

function tmpAgents(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reg-test-"));
  const a1 = path.join(dir, "alpha");
  fs.mkdirSync(a1);
  fs.writeFileSync(
    path.join(a1, "agent.json"),
    JSON.stringify({ id: "alpha", department: "research", nativeTools: ["Read"], mcpTools: [] })
  );
  fs.writeFileSync(path.join(a1, "role.md"), "# Alpha\nResearch agent");
  fs.writeFileSync(path.join(a1, "CLAUDE.md"), "# Alpha procedures");
  const b1 = path.join(dir, "beta");
  fs.mkdirSync(b1);
  fs.writeFileSync(
    path.join(b1, "agent.json"),
    JSON.stringify({ id: "beta", department: "marketing", nativeTools: ["Read", "Glob"], mcpTools: ["xurl_get"] })
  );
  fs.writeFileSync(path.join(b1, "role.md"), "# Beta\nMarketing agent");
  fs.writeFileSync(path.join(b1, "CLAUDE.md"), "# Beta procedures");
  return dir;
}

describe("loadRegistry", () => {
  it("loads all agents and builds department map", () => {
    const dir = tmpAgents();
    const reg = loadRegistry(dir);
    expect(reg.agents.size).toBe(2);
    expect(reg.agents.get("alpha")?.department).toBe("research");
    expect(reg.byDepartment("research")?.id).toBe("alpha");
    expect(reg.byDepartment("marketing")?.id).toBe("beta");
    expect(reg.byDepartment("sales")).toBeUndefined();
  });

  it("reads role.md and CLAUDE.md into agent entry", () => {
    const dir = tmpAgents();
    const reg = loadRegistry(dir);
    const a = reg.agents.get("alpha")!;
    expect(a.roleMd).toContain("Research agent");
    expect(a.claudeMd).toContain("Alpha procedures");
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd swarm && pnpm test src/agents/registry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/agents/registry.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { parseAgentConfig, type AgentConfig } from "./agent-config.js";

export interface AgentEntry {
  config: AgentConfig;
  id: string;
  department: string;
  workspacePath: string;
  roleMd: string;
  claudeMd: string;
}

export interface Registry {
  agents: Map<string, AgentEntry>;
  byDepartment(dept: string): AgentEntry | undefined;
}

export function loadRegistry(agentsDir: string): Registry {
  const agents = new Map<string, AgentEntry>();
  const deptMap = new Map<string, AgentEntry>();

  if (!fs.existsSync(agentsDir)) return { agents, byDepartment: () => undefined };

  for (const name of fs.readdirSync(agentsDir)) {
    const dir = path.join(agentsDir, name);
    const configPath = path.join(dir, "agent.json");
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(configPath)) continue;

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const config = parseAgentConfig(raw);

    const roleMdPath = path.join(dir, "role.md");
    const claudeMdPath = path.join(dir, "CLAUDE.md");
    const roleMd = fs.existsSync(roleMdPath) ? fs.readFileSync(roleMdPath, "utf8") : "";
    const claudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, "utf8") : "";

    const entry: AgentEntry = {
      config,
      id: config.id,
      department: config.department,
      workspacePath: dir,
      roleMd,
      claudeMd,
    };
    agents.set(config.id, entry);
    if (!deptMap.has(config.department)) {
      deptMap.set(config.department, entry);
    }
  }

  return {
    agents,
    byDepartment(dept: string) {
      return deptMap.get(dept);
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/agents/registry.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/agents/registry.ts src/agents/registry.test.ts
git commit -m "feat(workspace): add agent registry with department lookup"
```

---

### Task 0.3: Compose system prompt

**Files:**
- Create: `src/agents/compose-prompt.ts`

- [ ] **Step 1: Write failing test**

Create `src/agents/compose-prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { composePrompt } from "./compose-prompt.js";

describe("composePrompt", () => {
  it("layers role → shared skills → agent CLAUDE.md → karpathy rules", () => {
    const p = composePrompt({
      roleMd: "# Role\nI am a researcher.",
      sharedSkills: ["# Wiki Conventions\nDrafts live in drafts/"],
      claudeMd: "# Agent Procedures\nAlways read README first.",
    });
    const parts = p.split("---");
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(p).toContain("I am a researcher");
    expect(p).toContain("Drafts live in drafts/");
    expect(p).toContain("Always read README first");
    expect(p).toContain("Think Before Coding");
  });

  it("omits empty sections", () => {
    const p = composePrompt({ roleMd: "# Role", sharedSkills: [], claudeMd: "" });
    expect(p).toContain("# Role");
    expect(p).toContain("Think Before Coding");
    expect(p).not.toContain("# Shared Skills");
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd swarm && pnpm test src/agents/compose-prompt.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/agents/compose-prompt.ts`:

```typescript
import { KARPATHY_RULES } from "./prompts.js";

export interface ComposeInput {
  roleMd: string;
  sharedSkills: string[];
  claudeMd: string;
}

export function composePrompt(input: ComposeInput): string {
  const sections: string[] = [];

  if (input.roleMd.trim()) {
    sections.push(input.roleMd.trim());
  }

  for (const skill of input.sharedSkills) {
    if (skill.trim()) sections.push(skill.trim());
  }

  if (input.claudeMd.trim()) {
    sections.push(input.claudeMd.trim());
  }

  sections.push(KARPATHY_RULES);

  return sections.join("\n\n---\n\n");
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/agents/compose-prompt.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/agents/compose-prompt.ts src/agents/compose-prompt.test.ts
git commit -m "feat(workspace): add layered system prompt composition"
```

---

### Task 0.4: Generic agent runner

**Files:**
- Create: `src/agents/runner.ts`
- Modify: `src/missions/store.ts`

- [ ] **Step 1: Widen the role type in store.ts**

Edit `src/missions/store.ts` line 23 — change the role type from a fixed union to `string` so dynamic agent IDs work:

```typescript
export interface AgentSession {
  missionId: string;
  role: string;
  sessionId: string;
  updatedAt: number;
}
```

Also update `getSession` signature at line 92:

```typescript
export function getSession(missionId: string, role: string): string | undefined {
```

- [ ] **Step 2: Create the runner**

Create `src/agents/runner.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { loadRegistry, type AgentEntry } from "./registry.js";
import { composePrompt } from "./compose-prompt.js";
import { buildWikiReaderMcpServer, buildLibrarianMcpServer } from "../tools/wiki.js";
import { buildPersonalToolsMcpServer } from "../tools/personal.js";
import { getSession, saveSession } from "../missions/store.js";

let _registry: ReturnType<typeof loadRegistry> | undefined;
function registry() {
  if (!_registry) _registry = loadRegistry(path.resolve("agents"));
  return _registry;
}
export function getRegistry() {
  return registry();
}

export interface RunAgentInput {
  agentId: string;
  missionId: string;
  task: string;
  onProgress?: (text: string) => void;
  extraMcpServers?: Record<string, unknown>;
  extraAllowedTools?: string[];
}

export interface RunAgentOutput {
  summary: string;
  sessionId: string;
}

function loadSharedSkills(): string[] {
  const skillsDir = path.resolve("skills/shared");
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => fs.readFileSync(path.join(skillsDir, f), "utf8"));
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const entry = registry().agents.get(input.agentId);
  if (!entry) throw new Error(`Agent not found: ${input.agentId}`);

  const resume = getSession(input.missionId, input.agentId);

  const systemPrompt = composePrompt({
    roleMd: entry.roleMd,
    sharedSkills: loadSharedSkills(),
    claudeMd: entry.claudeMd,
  });

  const mcpServers: Record<string, unknown> = {};
  const allowedTools: string[] = [...entry.config.nativeTools];

  // Wiki read is always available
  const wikiRead = buildWikiReaderMcpServer();
  mcpServers["swarm-wiki-read"] = wikiRead;
  allowedTools.push(
    "mcp__swarm-wiki-read__read_wiki_page",
    "mcp__swarm-wiki-read__list_wiki_pages",
    "mcp__swarm-wiki-read__search_wiki"
  );

  // fetch_url from librarian MCP
  if (entry.config.mcpTools.includes("fetch_url")) {
    const libMcp = buildLibrarianMcpServer();
    mcpServers["swarm-wiki"] = libMcp;
    allowedTools.push("mcp__swarm-wiki__fetch_url");
  }

  // Personal tools (scratchpad + submit_to_librarian)
  const personal = buildPersonalToolsMcpServer(input.agentId, input.missionId);
  mcpServers[`swarm-personal-${input.agentId}`] = personal;
  const pKey = `mcp__swarm-personal-${input.agentId}__`;
  allowedTools.push(
    `${pKey}read_scratchpad`,
    `${pKey}write_scratchpad`,
    `${pKey}append_scratchpad`,
    `${pKey}list_scratchpad`
  );
  if (entry.config.mcpTools.includes("submit_to_librarian")) {
    allowedTools.push(`${pKey}submit_to_librarian`);
  }

  // Extra MCP servers (xurl_get, propose_publish, posthog, etc.)
  if (input.extraMcpServers) {
    Object.assign(mcpServers, input.extraMcpServers);
  }
  if (input.extraAllowedTools) {
    allowedTools.push(...input.extraAllowedTools);
  }

  const result = query({
    prompt: input.task,
    options: {
      model: entry.config.model,
      systemPrompt,
      cwd: config.swarm.wikiPath,
      mcpServers,
      allowedTools,
      permissionMode: entry.config.nativeTools.includes("Write") ? "acceptEdits" : "default",
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

  saveSession({ missionId: input.missionId, role: input.agentId, sessionId });
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
cd swarm && git add src/agents/runner.ts src/missions/store.ts
git commit -m "feat(workspace): add generic runAgent with layered prompt + dynamic tools"
```

---

### Task 0.5: Hire CLI script

**Files:**
- Create: `src/agents/hire.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

Create `src/agents/hire.ts`:

```typescript
#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const USAGE = `
Usage: pnpm hire <agent-id> --role <path-to-role-md> --department <dept> [--tools <comma-sep>] [--model <model>]

Example:
  pnpm hire x-researcher --role ../agency-agents/marketing/marketing-content-creator.md --department research --tools Read,Write,Edit,Glob,Grep
`.trim();

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help") {
    console.log(USAGE);
    process.exit(0);
  }

  const agentId = args[0];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(agentId)) {
    console.error(`Invalid agent id: ${agentId}. Use lowercase alphanumeric + hyphens.`);
    process.exit(1);
  }

  function flag(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  const rolePath = flag("role");
  const department = flag("department");
  const toolsCsv = flag("tools") ?? "Read,Glob,Grep";
  const model = flag("model") ?? "claude-sonnet-4-6";

  if (!rolePath || !department) {
    console.error("--role and --department are required.");
    process.exit(1);
  }

  const absRole = path.resolve(rolePath);
  if (!fs.existsSync(absRole)) {
    console.error(`Role file not found: ${absRole}`);
    process.exit(1);
  }

  const agentDir = path.resolve("agents", agentId);
  if (fs.existsSync(agentDir)) {
    console.error(`Agent workspace already exists: ${agentDir}`);
    process.exit(1);
  }

  // Scaffold
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(agentDir, "memory"));
  fs.mkdirSync(path.join(agentDir, "scratchpad"));

  // Copy role file
  fs.copyFileSync(absRole, path.join(agentDir, "role.md"));
  console.log(`  copied ${path.basename(absRole)} → agents/${agentId}/role.md`);

  // Generate agent.json
  const nativeTools = toolsCsv.split(",").map((t) => t.trim()).filter(Boolean);
  const config = {
    id: agentId,
    department,
    model,
    nativeTools,
    mcpTools: ["fetch_url", "submit_to_librarian"],
    created: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(agentDir, "agent.json"), JSON.stringify(config, null, 2) + "\n");
  console.log(`  wrote agents/${agentId}/agent.json`);

  // Generate starter CLAUDE.md
  const claudeMd = [
    `# ${agentId} — Procedures`,
    ``,
    `## Before every task`,
    `1. Read \`drafts/README.md\` for the drafts lifecycle convention.`,
    `2. Use Glob and Grep to understand current wiki state before creating new content.`,
    `3. Check your scratchpad for notes from prior missions.`,
    ``,
    `## Your workspace`,
    `Your working directory is the wiki root. Use Read/Write/Edit/Glob/Grep directly on wiki files.`,
    `Your scratchpad and memory are available via MCP tools — use them for private notes.`,
    ``,
    `## Customize this file`,
    `Add department-specific and agent-specific rules below this line.`,
    ``,
    `---`,
    ``,
    `(add your rules here)`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(agentDir, "CLAUDE.md"), claudeMd);
  console.log(`  wrote agents/${agentId}/CLAUDE.md`);

  // Empty MEMORY.md
  fs.writeFileSync(path.join(agentDir, "memory", "MEMORY.md"), "# Memory\n\n(no entries yet)\n");

  console.log(`\n✅ Agent "${agentId}" hired into department "${department}".`);
  console.log(`   Edit agents/${agentId}/CLAUDE.md to customize procedures.`);
  console.log(`   Edit agents/${agentId}/role.md to tune the role.`);
}

main();
```

- [ ] **Step 2: Add npm script**

Edit `package.json` — add to `"scripts"`:

```json
    "hire": "tsx src/agents/hire.ts"
```

- [ ] **Step 3: Test the script**

```bash
cd swarm && pnpm hire test-agent --role ../agency-agents/marketing/marketing-content-creator.md --department research --tools Read,Write,Edit,Glob,Grep
ls agents/test-agent/
cat agents/test-agent/agent.json
```

Expected: directory scaffolded, role.md is a copy of content-creator, agent.json has correct config.

```bash
rm -rf agents/test-agent
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/agents/hire.ts package.json
git commit -m "feat(workspace): add pnpm hire CLI for agent scaffolding"
```

---

## Phase 1 — Drafts Foundation

Goal: the drafts data layer + wiki convention doc. No agents, no Discord changes. Publisher will use `drafts-fs.ts` to validate/transition drafts when the ✅ reaction fires.

### Task 1.1: Frontmatter parser + state machine

**Files:**
- Create: `src/tools/drafts-fs.ts`
- Create: `src/tools/drafts-fs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tools/drafts-fs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseDraft,
  serializeDraft,
  readDraft,
  writeDraft,
  transitionDraft,
  ALLOWED_TRANSITIONS,
  type Draft,
} from "./drafts-fs.js";

describe("parseDraft / serializeDraft", () => {
  it("roundtrips parse → serialize → parse", () => {
    const raw = [
      "---",
      "id: 2026-04-16-x-test",
      "platform: x",
      "status: draft",
      "author: x-researcher",
      "created: 2026-04-16T10:00:00.000Z",
      "topic: Test topic",
      'post_text: "Hello world"',
      "source_urls:",
      "  - https://example.com/a",
      "---",
      "",
      "Body notes.",
      "",
    ].join("\n");
    const d = parseDraft(raw);
    expect(d.frontmatter.id).toBe("2026-04-16-x-test");
    expect(d.frontmatter.post_text).toBe("Hello world");
    const reserialized = serializeDraft(d);
    const reparsed = parseDraft(reserialized);
    expect(reparsed.frontmatter).toEqual(d.frontmatter);
  });

  it("rejects missing frontmatter", () => {
    expect(() => parseDraft("just text")).toThrow(/frontmatter/i);
  });
});

function tmpWiki(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drafts-test-"));
  fs.mkdirSync(path.join(dir, "drafts"), { recursive: true });
  return dir;
}

describe("file ops + state machine", () => {
  it("writeDraft + readDraft roundtrip", () => {
    const wiki = tmpWiki();
    const d: Draft = {
      frontmatter: {
        id: "2026-04-16-x-t",
        platform: "x",
        status: "draft",
        author: "x-researcher",
        created: "2026-04-16T10:00:00.000Z",
        topic: "T",
        post_text: "Hi",
      },
      body: "Notes",
    };
    writeDraft(wiki, d);
    const loaded = readDraft(wiki, d.frontmatter.id);
    expect(loaded.frontmatter.id).toBe("2026-04-16-x-t");
  });

  it("transitionDraft enforces allowed transitions", () => {
    const wiki = tmpWiki();
    const d: Draft = {
      frontmatter: {
        id: "2026-04-16-x-t2",
        platform: "x",
        status: "draft",
        author: "x-researcher",
        created: "2026-04-16T10:00:00.000Z",
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

  it("ALLOWED_TRANSITIONS forbids published → draft", () => {
    expect(ALLOWED_TRANSITIONS.published).not.toContain("draft");
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `drafts-fs.ts`**

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
  author: string;
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

export const ALLOWED_TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  draft: ["ready-for-review", "rejected"],
  "ready-for-review": ["awaiting-approval", "draft", "rejected"],
  "awaiting-approval": ["published", "rejected", "ready-for-review"],
  published: ["measured"],
  measured: [],
  rejected: ["draft"],
};

const FM_DELIM = "---";

export function parseDraft(raw: string): Draft {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== FM_DELIM) throw new Error("Draft missing frontmatter opening ---");
  const end = lines.indexOf(FM_DELIM, 1);
  if (end === -1) throw new Error("Draft missing frontmatter closing ---");
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n/, "");
  const frontmatter = parseSimpleYaml(fmLines) as DraftFrontmatter;
  return { frontmatter, body };
}

export function serializeDraft(d: Draft): string {
  const fm = serializeSimpleYaml(d.frontmatter);
  return `${FM_DELIM}\n${fm}${FM_DELIM}\n\n${d.body}${d.body.endsWith("\n") ? "" : "\n"}`;
}

export function readDraft(wikiRoot: string, id: string): Draft {
  const abs = safeResolve(wikiRoot, `drafts/${id}.md`);
  if (!fs.existsSync(abs)) throw new Error(`Draft not found: ${id}`);
  return parseDraft(fs.readFileSync(abs, "utf8"));
}

export function writeDraft(wikiRoot: string, draft: Draft): string {
  const rel = `drafts/${draft.frontmatter.id}.md`;
  const abs = safeResolve(wikiRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeDraft(draft), "utf8");
  return rel;
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
    throw new Error(`Invalid transition ${d.frontmatter.status} → ${nextStatus} for ${id}`);
  }
  const updated: Draft = {
    frontmatter: { ...d.frontmatter, ...patch, status: nextStatus },
    body: d.body,
  };
  writeDraft(wikiRoot, updated);
  return updated;
}

function parseSimpleYaml(lines: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`Bad frontmatter line: ${line}`);
    const key = m[1];
    const rest = m[2];
    if (rest === "") {
      const items: string[] = [];
      const nested: Record<string, unknown> = {};
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
          nested[nm[1]] = scalar(nm[2]);
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
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    return t.slice(1, -1);
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
  if (typeof v === "string") return /[:\n"]/.test(v) ? JSON.stringify(v) : v;
  return String(v);
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/tools/drafts-fs.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/tools/drafts-fs.ts src/tools/drafts-fs.test.ts
git commit -m "feat(drafts): add frontmatter parser, state machine, and file ops"
```

---

### Task 1.2: Wiki drafts convention + shared skill

**Files:**
- Create: `wiki/drafts/README.md`
- Create: `wiki/drafts/.gitkeep`
- Create: `skills/shared/wiki-conventions.md`

- [ ] **Step 1: Create wiki/drafts/README.md**

Create `wiki/drafts/README.md`:

```markdown
---
title: Drafts — Content Pipeline Convention
type: index
created: 2026-04-16
updated: 2026-04-16
---

# Drafts

This folder holds in-flight social posts. Every file is Markdown with YAML frontmatter.

## Lifecycle

```
draft → ready-for-review → awaiting-approval → published → measured
         │                                      │
         └─→ rejected ←────────────────────────┘
```

- **draft** — still being written
- **ready-for-review** — finished, waiting for human or marketing agent
- **awaiting-approval** — marketing proposed publishing, waiting for ✅ in Discord
- **published** — posted, `published_url` + `published_at` filled in by Publisher
- **measured** — metrics fetched, terminal
- **rejected** — human said no, can return to `draft`

## Filename rule

`<YYYY-MM-DD>-<platform>-<slug>.md` — e.g. `2026-04-16-x-ai-agents-in-automation.md`

## Frontmatter schema

```yaml
---
id: 2026-04-16-x-ai-agents-in-automation
platform: x
status: draft
author: x-researcher
created: 2026-04-16T10:00:00.000Z
topic: AI agents in automation
post_text: "The actual text that will be posted."
source_urls:
  - https://example.com/article
published_url: https://x.com/...
published_at: 2026-04-16T11:00:00Z
metrics:
  impressions: 1234
  engagement: 56
  measured_at: 2026-04-17T11:00:00Z
---

Body: research notes, alternatives, rationale.
The text that gets posted is `post_text` in frontmatter, NOT the body.
```

## Rules

1. Never edit `id` or `created` after creation.
2. Only the Publisher fills `published_url`, `published_at`, `metrics`.
3. Research creates drafts. Marketing reads them, proposes publishing, and later adds metrics.
4. The `post_text` field is what gets published. Body is for your own reasoning.
5. To transition status: edit the `status:` line directly with the Edit tool.
```

- [ ] **Step 2: Create shared skill**

Create `skills/shared/wiki-conventions.md`:

```markdown
---
name: wiki-conventions
description: Required reading for all swarm agents. Wiki structure, drafts lifecycle, file conventions.
---

# Wiki Conventions

Your working directory is the wiki root. Use native tools:
- **Glob** to find files: `drafts/*.md`, `entities/*.md`
- **Grep** to search content across the wiki
- **Read** to open any wiki page
- **Write** to create new pages (include YAML frontmatter per wiki CLAUDE.md)
- **Edit** to modify existing pages (prefer Edit over Write for changes)

## Wiki structure

- `entities/` — people, companies, tools
- `concepts/` — ideas, patterns, decisions
- `projects/` — long-running initiatives
- `sources/` — ingested external content
- `drafts/` — in-flight social posts (see `drafts/README.md`)
- `index.md` — entry point
- `log.md` — append-only log of writes

## Drafts

Read `drafts/README.md` before creating or touching any draft.
Key rules:
- Filename: `<date>-<platform>-<slug>.md`
- The `post_text` frontmatter field = what gets published
- Body = your notes, research, rationale (never published)
- Transition status by editing the `status:` line

## Cross-links

Use Obsidian-style wiki links: `[[entities/acme-corp]]`. No `.md` suffix.
```

- [ ] **Step 3: Create .gitkeep**

```bash
cd swarm && touch wiki/drafts/.gitkeep && mkdir -p skills/shared
```

- [ ] **Step 4: Commit wiki side**

```bash
cd swarm/wiki && git add drafts/README.md drafts/.gitkeep && git commit -m "ingest: add drafts convention for content pipeline"
```

- [ ] **Step 5: Commit swarm side**

```bash
cd swarm && git add skills/shared/wiki-conventions.md
git commit -m "feat(skills): add shared wiki-conventions skill"
```

---

## Phase 2 — Hire First Two Agents + Discord Routing

Goal: hire x-researcher and x-marketer from agency-agents, write their CLAUDE.md procedures, wire Discord department channels to the generic runner. End state: post in `#research` → x-researcher drafts a post into `wiki/drafts/`.

### Task 2.1: Hire x-researcher

**Files:**
- Create: `agents/x-researcher/` (via hire script)
- Edit: `agents/x-researcher/CLAUDE.md`
- Edit: `agents/x-researcher/agent.json`

- [ ] **Step 1: Run hire**

```bash
cd swarm && pnpm hire x-researcher \
  --role ../agency-agents/marketing/marketing-content-creator.md \
  --department research \
  --tools Read,Write,Edit,Glob,Grep
```

Expected: workspace scaffolded at `agents/x-researcher/`.

- [ ] **Step 2: Add fetch_url to mcpTools in agent.json**

Edit `agents/x-researcher/agent.json` — set `mcpTools` to include fetch_url and submit_to_librarian:

```json
{
  "id": "x-researcher",
  "department": "research",
  "model": "claude-sonnet-4-6",
  "nativeTools": ["Read", "Write", "Edit", "Glob", "Grep"],
  "mcpTools": ["fetch_url", "submit_to_librarian"],
  "created": "2026-04-16T00:00:00Z"
}
```

- [ ] **Step 3: Write the CLAUDE.md procedures**

Edit `agents/x-researcher/CLAUDE.md`:

```markdown
# x-researcher — Procedures

## Before every task
1. Read `drafts/README.md` for the drafts lifecycle.
2. Glob `drafts/*.md` to see existing drafts and avoid duplicates.
3. Check your scratchpad for notes from prior missions.

## Your workspace
Your cwd is the wiki root. Use Read/Write/Edit/Glob/Grep directly on all wiki files.

## How to draft a post

1. **Research first.** Use `fetch_url` to pull external sources. Grep the wiki for existing context.
2. **Create the draft.** Use Write to create `drafts/<YYYY-MM-DD>-<platform>-<slug>.md`. Include full frontmatter per `drafts/README.md`. Put the actual post in `post_text`. Put your research notes in the body.
3. **Mark ready.** When you're confident in the draft, use Edit to change `status: draft` to `status: ready-for-review`.
4. **Report.** Return: draft id, one-line summary, link to the draft file.

## Constraints
- Maximum 280 characters for X posts in `post_text`. Count carefully.
- For LinkedIn, longer is fine but keep under 3000 characters.
- Always include at least one `source_urls` entry linking to what you researched.
- Never set status beyond `ready-for-review`. Marketing handles the rest.

## You do NOT publish
You never write to X, LinkedIn, or any external system. Your artifacts are drafts in the wiki.

## Durable findings
When you discover a fact worth remembering (a company detail, a market trend, a useful source), use `submit_to_librarian` to file it. Don't rely on your scratchpad for cross-mission knowledge.
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add agents/x-researcher/
git commit -m "feat(agents): hire x-researcher from marketing-content-creator"
```

---

### Task 2.2: Hire x-marketer

**Files:**
- Create: `agents/x-marketer/` (via hire script)
- Edit: `agents/x-marketer/CLAUDE.md`
- Edit: `agents/x-marketer/agent.json`

- [ ] **Step 1: Run hire**

```bash
cd swarm && pnpm hire x-marketer \
  --role ../agency-agents/marketing/marketing-twitter-engager.md \
  --department marketing \
  --tools Read,Edit,Glob,Grep
```

Note: no `Write` — marketer reads and edits drafts but doesn't create new ones.

- [ ] **Step 2: Update agent.json**

Edit `agents/x-marketer/agent.json`:

```json
{
  "id": "x-marketer",
  "department": "marketing",
  "model": "claude-sonnet-4-6",
  "nativeTools": ["Read", "Edit", "Glob", "Grep"],
  "mcpTools": ["fetch_url", "submit_to_librarian", "xurl_get", "propose_publish"],
  "created": "2026-04-16T00:00:00Z"
}
```

- [ ] **Step 3: Write the CLAUDE.md procedures**

Edit `agents/x-marketer/CLAUDE.md`:

```markdown
# x-marketer — Procedures

## Before every task
1. Read `drafts/README.md` for the drafts lifecycle.
2. Glob `drafts/*.md` and check for drafts with status `ready-for-review`.
3. Check your scratchpad for notes from prior missions.

## Your workspace
Your cwd is the wiki root. Use Read/Edit/Glob/Grep on wiki files. You do NOT have Write — you don't create drafts, only review and manage them.

## Common tasks

### Review and propose a draft for publishing
1. Use `list_drafts` or Glob `drafts/*.md` to find drafts with `status: ready-for-review`.
2. Read the draft. Check: is the post_text compelling? Right length? Good hook?
3. If edits needed, use Edit to improve `post_text` (stay in `ready-for-review`).
4. When satisfied, call `propose_publish` with the draft id. This transitions the draft to `awaiting-approval` and posts a marker message in #marketing for human approval.
5. DO NOT manually edit status to `awaiting-approval` — always use `propose_publish`.

### Check X performance
Use `xurl_get` for read-only Twitter API calls:
- `/2/users/me` — your account info + follower count
- `/2/users/by/username/<handle>` — look up any account
- `/2/tweets/<id>` — check a specific tweet's metrics

### Check website analytics
If PostHog MCP is available, use it to query xmation.ai visitor data.

## You do NOT publish directly
You never call xurl for POST/DELETE. Publishing is gated on a Discord ✅ reaction from the human. Use `propose_publish` to request it.

## After a post is published
24+ hours later, fetch metrics via `xurl_get` for the tweet. Edit the draft's frontmatter to add metrics, then change status to `measured`.
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add agents/x-marketer/
git commit -m "feat(agents): hire x-marketer from marketing-twitter-engager"
```

---

### Task 2.3: Config — department channels

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add department channel map**

Edit `src/config.ts` — extend the `discord` block to include a dynamic channel→department map:

```typescript
export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    ceoChannelId: required("DISCORD_CEO_CHANNEL_ID"),
    workshopChannelId: process.env.DISCORD_WORKSHOP_CHANNEL_ID || required("DISCORD_CEO_CHANNEL_ID"),
    departmentChannels: parseDepartmentChannels(process.env.DISCORD_DEPARTMENT_CHANNELS),
    allowedUserIds: required("DISCORD_ALLOWED_USER_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  swarm: {
    repoPath: path.resolve(required("SWARM_REPO_PATH")),
    worktreeRoot: path.resolve(process.env.SWARM_WORKTREE_ROOT ?? "./worktrees"),
    dbPath: path.resolve(process.env.SWARM_DB_PATH ?? "./data/swarm.db"),
    wikiPath: path.resolve(process.env.SWARM_WIKI_PATH ?? "./wiki"),
    scratchpadRoot: path.resolve(process.env.SWARM_SCRATCHPAD_ROOT ?? "./scratchpads"),
    xurlPath: process.env.XURL_PATH ?? "xurl",
    missionTimeoutMs: Number(process.env.SWARM_MISSION_TIMEOUT_MS ?? 30 * 60 * 1000),
  },
} as const;

function parseDepartmentChannels(raw?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [channelId, dept] = pair.split(":").map((s) => s.trim());
    if (channelId && dept) map.set(channelId, dept);
  }
  return map;
}
```

- [ ] **Step 2: Update .env.example**

Edit `.env.example` — append:

```
# Department channels: comma-separated pairs of channelId:department
# e.g. 123456:research,789012:marketing
DISCORD_DEPARTMENT_CHANNELS=
XURL_PATH=xurl
```

- [ ] **Step 3: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/config.ts .env.example
git commit -m "feat(config): add department channel map and xurl path"
```

---

### Task 2.4: Discord routing for department channels

**Files:**
- Modify: `src/discord/handlers.ts`

- [ ] **Step 1: Add imports and department routing**

Edit `src/discord/handlers.ts`. Add import at the top:

```typescript
import { runAgent, getRegistry } from "../agents/runner.js";
```

In `handleMessage`, insert after the `/ingest` check (around line 50) and before the CEO channel check:

```typescript
  const parentId =
    chType === ChannelType.PublicThread
      ? (msg.channel as ThreadChannel).parentId
      : msg.channelId;

  const department = parentId ? config.discord.departmentChannels.get(parentId) : undefined;
  if (department) {
    await handleDepartmentChannel(msg, department);
    return;
  }
```

At the bottom of the file, add the department handler:

```typescript
async function handleDepartmentChannel(msg: Message, department: string): Promise<void> {
  const agent = getRegistry().byDepartment(department);
  if (!agent) {
    await msg.reply(`⚠️ No agent assigned to department "${department}".`);
    return;
  }

  const chType = msg.channel.type;
  let thread: ThreadChannel;
  let missionId: string;

  if (chType === ChannelType.PublicThread) {
    thread = msg.channel as ThreadChannel;
    const existing = getMissionByThread(thread.id);
    if (!existing) {
      await thread.send(`⚠️ No mission bound to this thread. Post in the parent channel to start a new one.`);
      return;
    }
    missionId = existing.id;
  } else {
    const parent = msg.channel as TextChannel;
    thread = await parent.threads.create({
      name: `${department}-${msg.id.slice(-6)}`,
      startMessage: msg,
      autoArchiveDuration: 1440,
    });
    missionId = randomUUID().slice(0, 8);
    createMission({
      id: missionId,
      threadId: thread.id,
      brief: msg.content,
      status: "open",
      worktreePath: `(n/a: ${department} mission)`,
      branch: "(n/a)",
    });
    await thread.send(`🏢 **${department}** → **${agent.id}** — mission \`${missionId}\` started.`);
  }

  const tag = `[\`${missionId}\`]`;
  if (inflight.has(missionId)) {
    await thread.send(`⏳ ${agent.id} is already working on this mission.`);
    return;
  }
  inflight.add(missionId);

  const extraMcp = buildExtraMcp(agent);

  try {
    const out = await runAgent({
      agentId: agent.id,
      missionId,
      task: msg.content,
      onProgress: (t) => {
        const snippet = t.slice(0, 1500);
        thread.send(`${tag} **${agent.id}**: ${snippet}`).catch(() => {});
      },
      extraMcpServers: extraMcp.servers,
      extraAllowedTools: extraMcp.tools,
    });
    await sendLong(thread, `🏢 **${agent.id}:** ${out.summary}`);
  } finally {
    inflight.delete(missionId);
  }
}

function buildExtraMcp(agent: { config: { mcpTools: string[] }; id: string }): {
  servers: Record<string, unknown>;
  tools: string[];
} {
  const servers: Record<string, unknown> = {};
  const tools: string[] = [];

  if (agent.config.mcpTools.includes("xurl_get")) {
    const { buildMarketingReadMcpServer } = require("../tools/marketing-read.js");
    servers["swarm-marketing-read"] = buildMarketingReadMcpServer();
    tools.push("mcp__swarm-marketing-read__xurl_get");
  }

  if (agent.config.mcpTools.includes("propose_publish")) {
    const { buildProposePublishMcpServer } = require("../tools/propose-publish.js");
    servers["swarm-marketing-propose"] = buildProposePublishMcpServer();
    tools.push("mcp__swarm-marketing-propose__propose_publish");
  }

  return { servers, tools };
}
```

**Note:** `buildExtraMcp` uses dynamic require to avoid importing MCP servers that don't exist yet. In Phase 3 we create these files. Until then, no agent has `xurl_get` or `propose_publish` in their config, so the require is never hit. If you prefer, use `await import()` instead.

- [ ] **Step 2: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS (or minor typing on dynamic require — if so, switch to `await import()`).

- [ ] **Step 3: Smoke test (research only)**

Set `DISCORD_DEPARTMENT_CHANNELS=<research-channel-id>:research` in `.env`. Start dev server:

```bash
cd swarm && pnpm dev
```

Post in `#research`: `"Draft an X post about Karpathy's autoresearch project. Keep it under 240 chars. Include a source."`

Expected: bot creates thread, x-researcher works, a file appears in `wiki/drafts/` with status `ready-for-review`.

```bash
ls swarm/wiki/drafts/
cat swarm/wiki/drafts/*.md
```

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/discord/handlers.ts
git commit -m "feat(discord): route department channels to generic runAgent"
```

---

## Phase 3 — Publisher + Approval Flow

Goal: Marketing agent can propose publishing via `propose_publish` MCP, human approves via ✅ reaction, Publisher module executes `xurl`, result written back to draft. End state: full pipeline from `#research` brief to published tweet.

### Task 3.1: Publisher xurl module

**Files:**
- Create: `src/publisher/xurl.ts`
- Create: `src/publisher/xurl.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/publisher/xurl.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { postToX, XurlError } from "./xurl.js";

const execMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execMock(...args),
}));

describe("postToX", () => {
  beforeEach(() => execMock.mockReset());

  it("builds correct argv", async () => {
    execMock.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: Function) => {
      cb(null, JSON.stringify({ data: { id: "123" } }), "");
    });
    const r = await postToX({ text: "Hello" }, { xurlPath: "/bin/xurl" });
    expect(r.tweetId).toBe("123");
    expect(r.url).toBe("https://x.com/i/web/status/123");
    expect(execMock.mock.calls[0][1]).toEqual([
      "-X", "POST", "-H", "content-type: application/json",
      "-d", JSON.stringify({ text: "Hello" }), "/2/tweets",
    ]);
  });

  it("throws XurlError on non-zero exit", async () => {
    execMock.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: Function) => {
      cb(new Error("exit 1"), "", "unauthorized");
    });
    await expect(postToX({ text: "Hi" }, { xurlPath: "xurl" })).rejects.toThrow(XurlError);
  });

  it("throws XurlError when API returns errors", async () => {
    execMock.mockImplementation((_f: unknown, _a: unknown, _o: unknown, cb: Function) => {
      cb(null, JSON.stringify({ errors: [{ message: "dup" }] }), "");
    });
    await expect(postToX({ text: "Hi" }, { xurlPath: "xurl" })).rejects.toThrow(/dup/);
  });

  it("rejects text over 280 chars", async () => {
    await expect(postToX({ text: "a".repeat(281) }, { xurlPath: "xurl" })).rejects.toThrow(/280/);
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd swarm && pnpm test src/publisher/xurl.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

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

export interface PostToXInput { text: string }
export interface PostToXOutput { tweetId: string; url: string }
export interface PostToXOptions { xurlPath: string; timeoutMs?: number }

export async function postToX(input: PostToXInput, opts: PostToXOptions): Promise<PostToXOutput> {
  if (!input.text) throw new XurlError("postToX: empty text");
  if (input.text.length > 280) throw new XurlError(`postToX: text exceeds 280 chars (${input.text.length})`);

  const body = JSON.stringify({ text: input.text });
  const argv = ["-X", "POST", "-H", "content-type: application/json", "-d", body, "/2/tweets"];

  let stdout: string;
  try {
    const res = await execFileP(opts.xurlPath, argv, { timeout: opts.timeoutMs ?? 20_000 });
    stdout = res.stdout;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    throw new XurlError(`xurl failed: ${e.message}`, e.stderr);
  }

  let parsed: { data?: { id: string }; errors?: Array<{ message: string }> };
  try { parsed = JSON.parse(stdout); } catch { throw new XurlError(`xurl returned non-JSON: ${stdout.slice(0, 200)}`); }
  if (parsed.errors?.length) throw new XurlError(parsed.errors.map((e) => e.message).join("; "));
  const id = parsed.data?.id;
  if (!id) throw new XurlError(`xurl response missing tweet id: ${stdout.slice(0, 200)}`);
  return { tweetId: id, url: `https://x.com/i/web/status/${id}` };
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/publisher/xurl.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/publisher/xurl.ts src/publisher/xurl.test.ts
git commit -m "feat(publisher): add postToX via xurl with unit tests"
```

---

### Task 3.2: Approval store

**Files:**
- Create: `src/publisher/approval-store.ts`
- Create: `src/publisher/approval-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/publisher/approval-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createApprovalStore, type ApprovalStore } from "./approval-store.js";

function mem(): ApprovalStore {
  return createApprovalStore(new Database(":memory:"));
}

describe("approval store", () => {
  let store: ApprovalStore;
  beforeEach(() => { store = mem(); });

  it("insert + get", () => {
    store.insert({ messageId: "m1", draftId: "d1", platform: "x" });
    expect(store.get("m1")?.draftId).toBe("d1");
  });

  it("returns undefined for unknown", () => {
    expect(store.get("nope")).toBeUndefined();
  });

  it("delete removes row", () => {
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

- [ ] **Step 3: Implement**

Create `src/publisher/approval-store.ts`:

```typescript
import type { Database as BetterSqlite3 } from "better-sqlite3";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

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
  db.exec(`CREATE TABLE IF NOT EXISTS approvals (
    message_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );`);

  return {
    insert(row) {
      db.prepare(`INSERT INTO approvals (message_id, draft_id, platform, created_at) VALUES (?, ?, ?, ?)`).run(
        row.messageId, row.draftId, row.platform, Date.now()
      );
    },
    get(messageId) {
      const r = db.prepare(`SELECT message_id, draft_id, platform, created_at FROM approvals WHERE message_id = ?`).get(messageId) as any;
      if (!r) return undefined;
      return { messageId: r.message_id, draftId: r.draft_id, platform: r.platform, createdAt: r.created_at };
    },
    delete(messageId) {
      db.prepare(`DELETE FROM approvals WHERE message_id = ?`).run(messageId);
    },
  };
}

let _default: ApprovalStore | undefined;
export function approvalStore(): ApprovalStore {
  if (_default) return _default;
  fs.mkdirSync(path.dirname(config.swarm.dbPath), { recursive: true });
  _default = createApprovalStore(new Database(config.swarm.dbPath));
  return _default;
}
```

- [ ] **Step 4: Run tests**

```bash
cd swarm && pnpm test src/publisher/approval-store.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/publisher/approval-store.ts src/publisher/approval-store.test.ts
git commit -m "feat(publisher): add approval store with sqlite backing"
```

---

### Task 3.3: xurl_get MCP + propose_publish MCP

**Files:**
- Create: `src/tools/marketing-read.ts`
- Create: `src/tools/propose-publish.ts`

- [ ] **Step 1: Create marketing-read.ts**

Create `src/tools/marketing-read.ts`:

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileP = promisify(execFile);

const ALLOWED_PREFIXES = ["/2/users/me", "/2/users/", "/2/tweets/search", "/2/tweets/"];

export function buildMarketingReadMcpServer() {
  const xurlGet = tool(
    "xurl_get",
    "Read-only GET against the Twitter v2 API via xurl. Only allowlisted endpoints accepted.",
    { endpoint: z.string().describe("e.g. /2/users/me or /2/users/by/username/xmation_ai") },
    async (args) => {
      if (!ALLOWED_PREFIXES.some((p) => args.endpoint.startsWith(p))) {
        throw new Error(`xurl_get: endpoint not in allowlist: ${args.endpoint}`);
      }
      const res = await execFileP(config.swarm.xurlPath, [args.endpoint], { timeout: 15_000 });
      return { content: [{ type: "text" as const, text: res.stdout.slice(0, 20_000) }] };
    }
  );

  return createSdkMcpServer({ name: "swarm-marketing-read", version: "0.1.0", tools: [xurlGet] });
}
```

- [ ] **Step 2: Create propose-publish.ts**

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
    "Propose publishing a draft. Transitions to awaiting-approval, posts a marker message in the marketing channel. Human must react ✅ to publish.",
    { draft_id: z.string().describe("Draft id. Must be in status ready-for-review.") },
    async (args) => {
      const marketingChannelId = findMarketingChannel();
      if (!marketingChannelId) throw new Error("No marketing department channel configured");

      const draft = readDraft(config.swarm.wikiPath, args.draft_id);
      if (draft.frontmatter.status !== "ready-for-review") {
        throw new Error(`Draft ${args.draft_id} is ${draft.frontmatter.status}, expected ready-for-review`);
      }

      transitionDraft(config.swarm.wikiPath, args.draft_id, "awaiting-approval");

      const channel = await discord.channels.fetch(marketingChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) throw new Error("Marketing channel not accessible");

      const marker = [
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

      const sent = await (channel as TextChannel).send(marker);
      approvalStore().insert({ messageId: sent.id, draftId: draft.frontmatter.id, platform: draft.frontmatter.platform });

      return { content: [{ type: "text" as const, text: `proposed ${args.draft_id}; awaiting ✅ on message ${sent.id}` }] };
    }
  );

  return createSdkMcpServer({ name: "swarm-marketing-propose", version: "0.1.0", tools: [propose] });
}

function findMarketingChannel(): string | undefined {
  for (const [channelId, dept] of config.discord.departmentChannels) {
    if (dept === "marketing") return channelId;
  }
  return undefined;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd swarm && git add src/tools/marketing-read.ts src/tools/propose-publish.ts
git commit -m "feat(mcp): add xurl_get and propose_publish — the only two custom MCP tools"
```

---

### Task 3.4: Approval reaction handler

**Files:**
- Create: `src/publisher/approval.ts`
- Modify: `src/discord/client.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create the handler**

Create `src/publisher/approval.ts`:

```typescript
import type { Client, MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { config } from "../config.js";
import { approvalStore } from "./approval-store.js";
import { postToX } from "./xurl.js";
import { readDraft, transitionDraft } from "../tools/drafts-fs.js";

export function registerApprovalHandler(client: Client): void {
  client.on("messageReactionAdd", (reaction, user) => {
    handleReaction(reaction, user).catch((err) => console.error("[approval] error", err));
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
  if (emoji !== "✅" && emoji !== "❌") return;

  const row = approvalStore().get(reaction.message.id);
  if (!row) return;

  const channel = reaction.message.channel;
  const send = (t: string) => ("send" in channel ? channel.send(t).catch(() => {}) : Promise.resolve());

  if (emoji === "❌") {
    transitionDraft(config.swarm.wikiPath, row.draftId, "rejected");
    approvalStore().delete(reaction.message.id);
    await send(`❌ ${row.draftId}: rejected.`);
    return;
  }

  const draft = readDraft(config.swarm.wikiPath, row.draftId);
  try {
    if (row.platform === "x") {
      const result = await postToX({ text: draft.frontmatter.post_text }, { xurlPath: config.swarm.xurlPath });
      transitionDraft(config.swarm.wikiPath, row.draftId, "published", {
        published_url: result.url,
        published_at: new Date().toISOString(),
      });
      approvalStore().delete(reaction.message.id);
      await send(`✅ Published: ${result.url}`);
    } else {
      await send(`❌ LinkedIn publishing not implemented yet.`);
    }
  } catch (err) {
    await send(`❌ Publish failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 2: Add reaction intent to Discord client**

Edit `src/discord/client.ts` — add `GuildMessageReactions` intent and `Reaction` partial:

```typescript
import { Client, GatewayIntentBits, Partials } from "discord.js";

export const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});
```

- [ ] **Step 3: Register in index.ts**

Edit `src/index.ts`:

```typescript
import { startDiscord, discord } from "./discord/client.js";
import { registerHandlers } from "./discord/handlers.js";
import { registerApprovalHandler } from "./publisher/approval.js";

// ... existing error handlers ...

async function main(): Promise<void> {
  registerHandlers();
  registerApprovalHandler(discord);
  await startDiscord();
  console.log("[swarm] ready — waiting for missions");
}
```

- [ ] **Step 4: Typecheck**

```bash
cd swarm && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd swarm && git add src/publisher/approval.ts src/discord/client.ts src/index.ts
git commit -m "feat(publisher): add reaction-based approval handler for ✅/❌"
```

---

### Task 3.5: End-to-end smoke test

**Files:** None (test only).

- [ ] **Step 1: Configure .env**

Set in `.env`:

```
DISCORD_DEPARTMENT_CHANNELS=<research-channel-id>:research,<marketing-channel-id>:marketing
XURL_PATH=xurl
```

- [ ] **Step 2: Start dev server**

```bash
cd swarm && pnpm dev
```

- [ ] **Step 3: Research → Draft**

Post in `#research`:
> "Draft an X post about how we're building an AI agent company. Under 240 chars. Mention xmation.ai."

Verify: thread opens, x-researcher narrates, file appears in `wiki/drafts/` with status `ready-for-review`.

```bash
ls swarm/wiki/drafts/
```

- [ ] **Step 4: Marketing → Propose**

Post in `#marketing`:
> "Check for ready-for-review drafts and propose publishing the most recent one."

Verify: thread opens, x-marketer reads the draft, calls `propose_publish`, a marker message appears in `#marketing` with the post text in a code block and "React ✅ to publish" instruction.

- [ ] **Step 5: Approve → Publish**

React ✅ on the marker message.

Verify: bot replies `✅ Published: https://x.com/i/web/status/...`. Check the draft file:

```bash
cat swarm/wiki/drafts/*.md
```

Expected: `status: published`, `published_url` and `published_at` filled in.

- [ ] **Step 6: Reject path**

Create another draft via `#research`. Have marketing propose it. React ❌.

Verify: bot replies `❌ <id>: rejected.`, draft status is `rejected`.

- [ ] **Step 7: Commit any fixes**

```bash
cd swarm && git add -A && git commit -m "fix: smoke test adjustments"
```

---

## Post-plan: What you can do next without writing TypeScript

| Want to… | Do this |
|---|---|
| Add a LinkedIn writer | `pnpm hire linkedin-writer --role ../agency-agents/marketing/marketing-linkedin-content-creator.md --department research --tools Read,Write,Edit,Glob,Grep` + edit its CLAUDE.md |
| Add a strategy analyst | `pnpm hire strategy-analyst --role ../agency-agents/strategy/nexus-strategy.md --department strategy --tools Read,Glob,Grep` + add a `#strategy` channel to `DISCORD_DEPARTMENT_CHANNELS` |
| Change how the researcher drafts | Edit `agents/x-researcher/CLAUDE.md` |
| Change how ALL agents use the wiki | Edit `skills/shared/wiki-conventions.md` |
| Tune the Twitter voice | Edit `agents/x-marketer/role.md` (the copied file — your company's version) |
| Add PostHog MCP | Add `posthog` to `mcpTools` in `agents/x-marketer/agent.json` + wire the external MCP in `buildExtraMcp` |

## Known limitations (v1)

1. **LinkedIn publishing is a stub.** `postToLinkedIn` not implemented. X-only for now.
2. **One agent per department.** `byDepartment()` returns first match. For multi-agent departments, add `@agent` prefix routing later.
3. **No scheduled triggers.** Marketer only runs when prompted. Add cron-style daily metric pulls in Phase 4.
4. **Mission store hack.** Non-code missions use `worktreePath: "(n/a: ...)"`. Fine for now.
5. **Dynamic require in `buildExtraMcp`.** Switch to `await import()` when ready.
6. **Simple YAML parser.** Handles only our schema. Swap to `yaml` package if schema grows.
