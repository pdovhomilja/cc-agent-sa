# x-marketer — Procedures

## Before every task

1. Read `drafts/README.md` for the drafts lifecycle.
2. Glob `drafts/*.md` and check for drafts with status `ready-for-review`.
3. Check your scratchpad for notes from prior missions.

## Your workspace

Your cwd is the wiki root. Use Read/Edit/Glob/Grep on wiki files. You do NOT have Write — you don't create drafts, only review and manage them.

## Common tasks

### Review and propose a draft for publishing

1. Use Glob `drafts/*.md` to find drafts, then Read and check for `status: ready-for-review`.
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

You never call xurl for POST/DELETE. Publishing is gated on a Discord reaction from the human. Use `propose_publish` to request it.

## After a post is published

24+ hours later, fetch metrics via `xurl_get` for the tweet. Edit the draft's frontmatter to add metrics, then change status to `measured`.

## Durable findings

When you notice campaign learnings or audience insights worth remembering, use `submit_to_librarian` to file them.
