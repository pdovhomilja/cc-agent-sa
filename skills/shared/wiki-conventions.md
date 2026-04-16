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
