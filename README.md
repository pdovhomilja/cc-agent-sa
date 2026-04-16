# swarm

A Discord-driven AI agent swarm built on the Claude Agent SDK. Two systems coexist:

1. **Engineering pipeline** — a **CEO** orchestrator delegates coding missions to a **Coder** and quality review to a **Reviewer**, each running in an isolated git worktree.
2. **Workspace agents** — hire-by-copy agents (Research, Marketing, and any future role) that operate on the wiki using native tools, with behavior defined in markdown skill files. No TypeScript needed to add new agents.

Both systems share a persistent **wiki** (Karpathy-style LLM-maintained knowledge base) managed by a **Librarian** agent.

## Architecture

```
                          Discord
                            │
         ┌──────────────────┼───────────────────┐
         │                  │                    │
    #ceo channel      #research channel    #marketing channel
         │                  │                    │
         ▼                  ▼                    ▼
    ┌─────────┐       ┌────────────┐       ┌────────────┐
    │   CEO   │       │x-researcher│       │ x-marketer │
    │(orchestr)│       │ (workspace)│       │ (workspace)│
    └────┬────┘       └─────┬──────┘       └─────┬──────┘
         │                  │                    │
    ┌────┴────┐        wiki/drafts/         propose_publish
    │  Coder  │         (native tools)       → ✅ reaction
    │Reviewer │                              → xurl → X post
    └─────────┘
         │
    git worktree
```

**Engineering agents** (CEO, Coder, Reviewer, Librarian) are hard-coded in TypeScript with fixed system prompts. They work on code repos via git worktrees.

**Workspace agents** (x-researcher, x-marketer, and any you hire) are config-driven. Each has a directory with `role.md`, `agent.json`, and `CLAUDE.md`. A generic `runAgent()` loads the workspace, composes a layered prompt, and runs the session. Behavior is tuned by editing markdown, not code.

## Quick start

```bash
cd swarm
cp .env.example .env          # fill in your values
pnpm install
pnpm dev
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token from the Discord developer portal |
| `DISCORD_CEO_CHANNEL_ID` | Yes | Channel where humans post coding missions |
| `DISCORD_WORKSHOP_CHANNEL_ID` | No | Channel for Coder/Reviewer progress (defaults to CEO channel) |
| `DISCORD_ALLOWED_USER_IDS` | Yes | Comma-separated Discord user IDs allowed to command the bot |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SWARM_REPO_PATH` | Yes | Absolute path to the target git repo the Coder edits |
| `SWARM_WORKTREE_ROOT` | No | Worktree location (default `./worktrees`) |
| `SWARM_DB_PATH` | No | SQLite database path (default `./data/swarm.db`) |
| `SWARM_WIKI_PATH` | No | Wiki location (default `./wiki`) |
| `SWARM_SCRATCHPAD_ROOT` | No | Scratchpad location (default `./scratchpads`) |
| `SWARM_MISSION_TIMEOUT_MS` | No | CEO mission timeout (default 1800000 = 30 min) |
| `SWARM_LIBRARIAN_TIMEOUT_MS` | No | Librarian session timeout (default 600000 = 10 min) |
| `DISCORD_DEPARTMENT_CHANNELS` | No | Comma-separated `channelId:department` pairs for workspace agents |
| `XURL_PATH` | No | Path to `xurl` CLI binary for X/Twitter posting (default `xurl`) |

### Discord bot setup

1. Create an application at https://discord.com/developers/applications
2. Add a Bot. Enable **Message Content Intent**.
3. Invite the bot to your server with `bot` scope and permissions: Read Messages, Send Messages, Create Public Threads, Send Messages in Threads, Add Reactions.
4. Copy channel IDs (Developer Mode -> right click channel -> Copy ID).

## Engineering pipeline (CEO/Coder/Reviewer)

1. Post a mission in the `#ceo` channel: *"Add rate limiting middleware to POST /api/auth/login"*
2. Bot creates a thread, spins up a worktree, launches the CEO session.
3. CEO plans, delegates to Coder, then to Reviewer.
4. CEO summarizes in the thread. If approved, manually merge the worktree branch.
5. Reply in the thread to send follow-up instructions to the same mission.

Also works in DMs with the bot.

## Agent Workspaces (Hire-by-Copy)

### How it works

Each workspace agent is a directory under `agents/<id>/`:

```
agents/x-researcher/
├── role.md           # identity — copied from agency-agents library
├── agent.json        # config: department, model, native tools, MCP tools
├── CLAUDE.md         # procedures you write and iterate on
├── memory/           # persistent cross-mission notes
│   └── MEMORY.md
└── scratchpad/       # per-mission working notes
```

At runtime, `runAgent()` composes a layered system prompt:

```
role.md                           ← who you are (identity, expertise)
  + skills/shared/*.md            ← company-wide conventions (wiki, drafts)
  + agents/<id>/CLAUDE.md         ← this agent's specific procedures
  + KARPATHY_RULES                ← think before coding, simplicity first, etc.
```

Tools are mounted based on `agent.json`:
- **Native tools** (Read, Write, Edit, Glob, Grep) — direct file access on the wiki
- **MCP tools** (fetch_url, xurl_get, propose_publish, submit_to_librarian) — only for security boundaries and cross-system actions

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

This scaffolds `agents/linkedin-writer/` with a copied `role.md`, generated `agent.json`, and a starter `CLAUDE.md` you should customize.

### Customizing an agent

| What to change | File to edit | Effect |
| --- | --- | --- |
| Behavior and procedures | `agents/<id>/CLAUDE.md` | "Always read drafts/README.md first", "Max 280 chars for X" |
| Identity and expertise | `agents/<id>/role.md` | Brand voice, domain knowledge, removed capabilities |
| Tools and permissions | `agents/<id>/agent.json` | `nativeTools`, `mcpTools`, `model`, `department` |
| Company-wide conventions | `skills/shared/*.md` | Loaded into ALL workspace agents |

### Connecting to Discord

Map department channels in `.env`:

```env
DISCORD_DEPARTMENT_CHANNELS=123456789:research,987654321:marketing
```

Messages in those channels route to the first agent registered in that department. Each mission gets a thread with session resume support.

### Content pipeline (Research + Marketing)

Two pre-hired agents form an end-to-end X/Twitter content pipeline:

```
#research                    wiki/drafts/               #marketing                X/Twitter
    │                            │                          │                        │
    ▼                            ▼                          ▼                        ▼
 x-researcher ──Write──▶  draft.md          x-marketer ──propose_publish──▶  approval msg
                         (status: ready)                                     human ✅
                                                                                │
                                                                          Publisher ──xurl──▶ tweet
                                                                                │
                                                                     draft.md (status: published)
```

1. Post in `#research`: *"Draft an X post about AI agents. Under 240 chars."*
2. x-researcher fetches sources, writes draft to `wiki/drafts/`, marks `ready-for-review`
3. Post in `#marketing`: *"Check for ready drafts and propose publishing the best one."*
4. x-marketer reads draft, calls `propose_publish` -> approval marker appears in `#marketing`
5. React ✅ on the marker -> Publisher runs `xurl --auth oauth2` -> tweet goes live
6. React ❌ -> draft marked as rejected

Drafts are Markdown files with YAML frontmatter. Status lifecycle:

```
draft → ready-for-review → awaiting-approval → published → measured
         │                                      │
         └──→ rejected ←────────────────────────┘
```

## Wiki (persistent memory)

The swarm maintains an institutional-memory wiki at `wiki/` — its own git repo, maintained by the Librarian agent. See `wiki/CLAUDE.md` for the schema.

```
wiki/
├── CLAUDE.md        # Librarian's constitution (schema, rules)
├── index.md         # entry point
├── log.md           # append-only chronological log
├── entities/        # people, companies, tools
├── concepts/        # ideas, patterns, decisions
├── projects/        # long-running initiatives
├── sources/         # ingested external content
├── missions/        # completed swarm missions (auto-captured)
├── drafts/          # content pipeline drafts
└── inbox/           # staging area for unprocessed drops
```

**Commands in Discord (DM or channel):**

| Command | What it does |
| --- | --- |
| `/ingest <url-or-text>` | Librarian ingests source into wiki |
| `/ingest` + PDF attachment | Extracts text, then ingests |
| `/lint` | Wiki health check (orphans, broken links, empty pages) |
| `/wiki <query>` | Search wiki, top 10 hits with snippets |
| `/recent [N]` | Last N log entries (default 20, max 200) |

**Automatic behaviors:**
- Approved missions are captured into `wiki/missions/<id>.md` by a background Librarian session
- Any agent can call `submit_to_librarian` to file durable findings into `wiki/inbox/`
- Each agent has a private scratchpad under `scratchpads/<role>/`

## Project layout

```
swarm/
├── agents/                          # workspace agent directories
│   ├── x-researcher/                #   research agent (from marketing-content-creator)
│   └── x-marketer/                  #   marketing agent (from marketing-twitter-engager)
├── skills/
│   └── shared/
│       └── wiki-conventions.md      #   loaded into all workspace agents
├── wiki/                            # persistent wiki (own git repo, gitignored)
├── src/
│   ├── index.ts                     # entry point
│   ├── config.ts                    # env loading with lazy getters
│   ├── discord/
│   │   ├── client.ts                # Discord.js client setup
│   │   └── handlers.ts             # message routing: CEO, departments, ingest, wiki queries
│   ├── agents/
│   │   ├── prompts.ts              # CEO/Coder/Reviewer/Librarian system prompts
│   │   ├── ceo.ts                  # CEO orchestrator runner
│   │   ├── coder.ts                # Coder runner (git worktree)
│   │   ├── reviewer.ts            # Reviewer runner (read-only)
│   │   ├── librarian.ts           # Librarian runner (wiki write)
│   │   ├── agent-config.ts        # AgentConfig type + validator
│   │   ├── registry.ts            # loads agents/*/agent.json at startup
│   │   ├── compose-prompt.ts      # layers role.md + skills + CLAUDE.md + Karpathy rules
│   │   ├── runner.ts              # generic runAgent() for workspace agents
│   │   └── hire.ts                # pnpm hire CLI script
│   ├── tools/
│   │   ├── delegate.ts            # CEO's delegate_to_coder/_reviewer/_librarian MCP
│   │   ├── wiki.ts                # wiki MCP servers (reader + librarian)
│   │   ├── wiki-fs.ts             # wiki filesystem operations
│   │   ├── wiki-git.ts            # wiki git commit
│   │   ├── wiki-paths.ts          # path security (safeResolve)
│   │   ├── personal.ts            # per-agent scratchpad + submit_to_librarian MCP
│   │   ├── scratchpad-fs.ts       # scratchpad filesystem
│   │   ├── submit-inbox.ts        # inbox drop helper
│   │   ├── lint.ts                # wiki structural linter
│   │   ├── pdf.ts                 # PDF text extraction
│   │   ├── drafts-fs.ts           # draft frontmatter parser + state machine
│   │   ├── marketing-read.ts      # xurl_get MCP (read-only Twitter API)
│   │   └── propose-publish.ts     # propose_publish MCP (approval flow trigger)
│   ├── publisher/
│   │   ├── xurl.ts                # postToX via xurl CLI
│   │   ├── approval-store.ts      # SQLite: pending approval messages
│   │   └── approval.ts            # Discord ✅/❌ reaction handler
│   └── missions/
│       ├── store.ts               # SQLite: missions + agent sessions
│       ├── worktree.ts            # git worktree create/diff/merge/remove
│       └── capture.ts             # background mission capture to wiki
├── worktrees/                      # mission worktrees (gitignored)
├── scratchpads/                    # agent scratchpads (gitignored)
├── data/                           # SQLite DB (gitignored)
├── tests/                          # vitest test files
├── CLAUDE.md                       # Karpathy-inspired rules (all agents inherit)
└── package.json
```

## Adding new agents

### Workspace agents (no TypeScript)

```bash
# 1. Hire from the agency-agents library
pnpm hire strategy-analyst \
  --role ../agency-agents/strategy/nexus-strategy.md \
  --department strategy \
  --tools Read,Glob,Grep

# 2. Customize procedures
vim agents/strategy-analyst/CLAUDE.md

# 3. Add a Discord channel
# In .env: DISCORD_DEPARTMENT_CHANNELS=...,<channel-id>:strategy

# 4. Restart
pnpm dev
```

### Engineering pipeline agents (TypeScript)

1. Add system prompt in `src/agents/prompts.ts`
2. Create runner in `src/agents/<role>.ts` mirroring `reviewer.ts`
3. Add delegation tool in `src/tools/delegate.ts`
4. Whitelist in `allowedTools` in `src/agents/ceo.ts`

## Available npm scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Start with hot reload |
| `pnpm start` | Start (production) |
| `pnpm build` | TypeScript compile |
| `pnpm typecheck` | Type check without emitting |
| `pnpm test` | Run vitest suite |
| `pnpm test:watch` | Watch mode tests |
| `pnpm hire` | Scaffold a new workspace agent |

## Notes and caveats

- **Merging is manual.** The bot never pushes or merges code without you.
- **Publishing requires human approval.** Agents cannot post to X/LinkedIn directly — only `propose_publish` + your ✅ reaction triggers the Publisher.
- **LinkedIn publishing** is not yet implemented (X only via `xurl`).
- **One agent per department** currently. For multi-agent departments, add `@agent` prefix routing later.
- **Mission timeout** is not yet enforced in code for workspace agents.
- **Bash is allowlisted loosely** in `coder.ts`. Tighten before pointing at production repos.
