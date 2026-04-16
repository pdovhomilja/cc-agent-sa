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

## Extending

Add a new role (e.g. Researcher):
1. Add `RESEARCHER_SYSTEM_PROMPT` in `src/agents/prompts.ts`.
2. Create `src/agents/researcher.ts` mirroring `reviewer.ts`.
3. Add a `delegate_to_researcher` tool in `src/tools/delegate.ts`.
4. Whitelist it in `allowedTools` inside `src/agents/ceo.ts`.

## Notes & caveats

- **Merging is manual on purpose.** The bot never pushes or merges without you. When CEO signals approval, `cd` into `SWARM_REPO_PATH` and `git merge swarm/<mission-id>` yourself, or wire an approval reaction handler later.
- **Bash is allowlisted loosely.** Tighten `allowedTools` in `coder.ts` with an explicit command allowlist before pointing this at anything important.
- **Mission timeout** is not yet enforced in code — add a `setTimeout`/`AbortController` around `runCeo` when you need it.
- Diagnostics about missing modules will disappear after `npm install`.
