# swarm

A Discord-driven AI agent swarm built on the Claude Agent SDK. A **CEO** orchestrator talks to you in Discord, breaks goals into missions, and delegates implementation to a **Coder** and quality review to a **Reviewer**. Each mission runs in an isolated git worktree.

## Architecture

```
Discord #ceo channel (human)
        │
        ▼  (thread-per-mission)
    ┌───────┐   delegate_to_coder     ┌────────┐
    │  CEO  │ ──────────────────────▶ │ Coder  │ ── edits ──▶ worktree
    │       │                         └────────┘
    │       │   delegate_to_reviewer  ┌──────────┐
    │       │ ──────────────────────▶ │ Reviewer │ ── reads ──▶ worktree
    └───────┘                         └──────────┘
        │
        ▼  summary + approval request
Discord #ceo thread (human)
```

- **CEO** has no file tools. It only calls `delegate_to_coder` and `delegate_to_reviewer` (custom MCP tools defined in-process).
- **Coder** has `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Bash`. Works inside the mission's git worktree.
- **Reviewer** has read-only tools + `Bash` for running tests. Returns `APPROVE` or `REJECT`.
- Each role has its own Claude session with `resume` support across turns.
- All behavioral guardrails live in `CLAUDE.md` (Karpathy-inspired rules).

## Setup

```bash
cd swarm
cp .env.example .env
# fill in DISCORD_TOKEN, ANTHROPIC_API_KEY, channel IDs, user IDs, and SWARM_REPO_PATH
npm install
npm run dev
```

### Required env vars

| var | purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord developer portal |
| `DISCORD_CEO_CHANNEL_ID` | Channel where humans post mission briefs |
| `DISCORD_WORKSHOP_CHANNEL_ID` | Channel where Coder/Reviewer progress streams |
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated Discord user IDs allowed to command the CEO |
| `ANTHROPIC_API_KEY` | Claude API key |
| `SWARM_REPO_PATH` | Absolute path to the target git repo the Coder will edit |

### Discord bot setup

1. Create an application at https://discord.com/developers/applications
2. Add a Bot. Enable **Message Content Intent**.
3. Invite the bot to your server with `bot` scope and these permissions: Read Messages, Send Messages, Create Public Threads, Send Messages in Threads.
4. Copy channel IDs (Developer Mode → right click channel → Copy ID).

## Usage

1. Post a mission in the `#ceo` channel: *"Add rate limiting middleware to POST /api/auth/login"*
2. Bot creates a thread, spins up a worktree, launches the CEO session.
3. CEO plans, calls `delegate_to_coder`, which runs the Coder inside the worktree.
4. CEO calls `delegate_to_reviewer` on the resulting diff.
5. CEO summarizes in the thread. If approved, you can manually merge the worktree branch.
6. Reply in the thread to send follow-up instructions to the same mission.

## Layout

```
swarm/
├── CLAUDE.md                  # Karpathy-inspired rules (all agents inherit these)
├── src/
│   ├── index.ts               # entry
│   ├── config.ts              # env loading
│   ├── discord/
│   │   ├── client.ts
│   │   └── handlers.ts        # message → mission → CEO dispatch
│   ├── agents/
│   │   ├── prompts.ts         # CEO / Coder / Reviewer system prompts
│   │   ├── ceo.ts
│   │   ├── coder.ts
│   │   └── reviewer.ts
│   ├── tools/
│   │   └── delegate.ts        # in-process MCP server: delegate_to_coder / _reviewer
│   └── missions/
│       ├── store.ts           # SQLite: missions + session IDs
│       └── worktree.ts        # git worktree create/diff/merge/remove
├── worktrees/                 # mission worktrees (gitignored)
└── data/                      # SQLite DB (gitignored)
```

## Wiki (persistent memory)

The swarm maintains an institutional-memory wiki at `swarm/wiki/` — its own git repo, LLM-maintained by the Librarian agent. See `swarm/wiki/CLAUDE.md` for the schema.

- **Ingest a source:** DM the bot `/ingest <url-or-text>` or drop a markdown/text attachment with `/ingest` as the message body.
- **Ask a wiki question:** talk to the CEO normally. It has read-only wiki tools.
- **Browse:** open `swarm/wiki/` as an Obsidian vault.
- **Automatic mission capture:** when a reviewer approves a mission, a background Librarian session files it into `wiki/missions/<id>.md` and updates any affected entity/concept/project pages. Runs non-blocking; failures are logged to `wiki/inbox/_errors/`.
- **Agent scratchpads:** each agent (CEO, Coder, Reviewer) has its own private notes dir under `swarm/scratchpads/<role>/`. Agents use them for in-flight reasoning and lessons they don't want to forget.
- **Cross-agent notes:** any agent can call `submit_to_librarian` with a durable finding. The Librarian picks it up from `wiki/inbox/` on its next task.
- **Wiki commands in Discord:**
  - `/lint` — structural health check (orphans, broken links, empty pages, missing front-matter).
  - `/wiki <query>` — search the wiki; returns top 10 hits with snippets.
  - `/recent [N]` — last N entries from the wiki log (default 20, max 200).
- **PDF ingestion:** attach a `.pdf` file with `/ingest` as the message body — the bot extracts text locally and hands it to the Librarian.

Environment variables:

- `SWARM_WIKI_PATH` — wiki location (default `./wiki`).
- `SWARM_SCRATCHPAD_ROOT` — scratchpad location (default `./scratchpads`).
- `SWARM_LIBRARIAN_TIMEOUT_MS` — max duration of a single Librarian session (default 600000 = 10 min).

## Agent Workspaces (Hire-by-Copy)

Beyond the hard-coded CEO/Coder/Reviewer pipeline, the swarm supports **workspace-based agents** that you create by "hiring" — copying a role file from a skill library and customizing its procedures. No TypeScript needed.

### How it works

Each agent is a directory under `agents/<id>/`:

```
agents/x-researcher/
├── role.md           # identity (copied from agency-agents library)
├── agent.json        # config: department, model, tools
├── CLAUDE.md         # swarm-specific procedures you edit
├── memory/           # persistent cross-mission notes
│   └── MEMORY.md
└── scratchpad/       # per-mission working notes
```

A generic `runAgent()` function loads the workspace, composes a layered system prompt (role.md + shared skills + CLAUDE.md + Karpathy rules), mounts MCP tools based on `agent.json`, and runs the Claude session.

### Hiring a new agent

```bash
pnpm hire <agent-id> \
  --role <path-to-role-md> \
  --department <department> \
  --tools <comma-separated-native-tools> \
  [--model <model>]
```

Example — hire a LinkedIn content writer:

```bash
pnpm hire linkedin-writer \
  --role ../agency-agents/marketing/marketing-linkedin-content-creator.md \
  --department research \
  --tools Read,Write,Edit,Glob,Grep
```

This creates `agents/linkedin-writer/` with:
- `role.md` copied from the source file
- `agent.json` with your specified config
- A starter `CLAUDE.md` you should edit with department-specific procedures

### Customizing an agent

**Tune behavior:** edit `agents/<id>/CLAUDE.md` — this is the procedures layer. Add rules like "always check drafts/README.md first" or "maximum 280 characters for X posts."

**Tune identity:** edit `agents/<id>/role.md` — this is the personality/expertise layer. Add your brand voice, remove capabilities you don't want.

**Change tools:** edit `agents/<id>/agent.json`:
- `nativeTools` — which file tools the agent gets: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`
- `mcpTools` — which MCP tools to mount: `fetch_url`, `submit_to_librarian`, `xurl_get`, `propose_publish`
- `model` — which Claude model to use
- `department` — which Discord channel routes to this agent

### Connecting to Discord

Set `DISCORD_DEPARTMENT_CHANNELS` in `.env` as comma-separated `channelId:department` pairs:

```env
DISCORD_DEPARTMENT_CHANNELS=123456789:research,987654321:marketing
```

Messages in those channels route to the first agent registered in that department. The agent gets a thread per mission with session resume support.

### Content pipeline (Research + Marketing)

Two pre-hired agents demonstrate the full content pipeline:

1. **`#research` channel** — `x-researcher` drafts X/LinkedIn posts into `wiki/drafts/`
2. **`#marketing` channel** — `x-marketer` reviews drafts, calls `propose_publish`
3. **Approval marker** appears in `#marketing` with the post text
4. **React ✅** on the marker → Publisher module runs `xurl --auth oauth2` → tweet goes live
5. **React ❌** → draft marked as rejected

Drafts live in `wiki/drafts/` as Markdown with YAML frontmatter. Status lifecycle: `draft → ready-for-review → awaiting-approval → published → measured`.

Required env vars for the content pipeline:

| var | purpose |
|---|---|
| `DISCORD_DEPARTMENT_CHANNELS` | Comma-separated `channelId:department` pairs |
| `XURL_PATH` | Path to `xurl` CLI binary (default: `xurl`) |

### Shared skills

Files in `skills/shared/*.md` are loaded into every workspace agent's system prompt. Use them for company-wide conventions (wiki structure, drafts lifecycle, etc.).

### Layout (new files)

```
swarm/
├── agents/                       # agent workspaces (one dir per agent)
│   ├── x-researcher/             # research agent
│   └── x-marketer/               # marketing agent
├── skills/
│   └── shared/
│       └── wiki-conventions.md   # loaded into all agents
├── src/
│   ├── agents/
│   │   ├── agent-config.ts       # AgentConfig type + validator
│   │   ├── registry.ts           # loads agents/*/agent.json
│   │   ├── compose-prompt.ts     # layered prompt assembly
│   │   ├── runner.ts             # generic runAgent()
│   │   └── hire.ts               # pnpm hire CLI
│   ├── tools/
│   │   ├── drafts-fs.ts          # draft frontmatter + state machine
│   │   ├── marketing-read.ts     # xurl_get MCP (read-only Twitter)
│   │   └── propose-publish.ts    # propose_publish MCP
│   └── publisher/
│       ├── xurl.ts               # postToX via xurl CLI
│       ├── approval-store.ts     # SQLite: pending approvals
│       └── approval.ts           # Discord reaction handler
```

## Extending (code agents)

Add a new role to the CEO pipeline (e.g. Researcher):
1. Add `RESEARCHER_SYSTEM_PROMPT` in `src/agents/prompts.ts`.
2. Create `src/agents/researcher.ts` mirroring `reviewer.ts`.
3. Add a `delegate_to_researcher` tool in `src/tools/delegate.ts`.
4. Whitelist it in `allowedTools` inside `src/agents/ceo.ts`.

## Extending (workspace agents)

Add a new non-code agent — **no TypeScript needed:**
1. `pnpm hire <name> --role <file> --department <dept> --tools <tools>`
2. Edit `agents/<name>/CLAUDE.md` with procedures
3. Add a Discord channel and map it in `DISCORD_DEPARTMENT_CHANNELS`
4. Restart the bot

## Notes & caveats

- **Merging is manual on purpose.** The bot never pushes or merges without you.
- **Publishing requires human approval.** Agents cannot post to X/LinkedIn — only `propose_publish` + your ✅ reaction triggers the Publisher.
- **Bash is allowlisted loosely.** Tighten `allowedTools` in `coder.ts` before pointing this at anything important.
- **LinkedIn publishing** is not yet implemented (X only via `xurl`).
- **One agent per department** currently. For multi-agent departments, add `@agent` prefix routing.
- **Mission timeout** is not yet enforced — add `AbortController` around `runAgent` when needed.
