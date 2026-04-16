import {
  type Message,
  ChannelType,
  TextChannel,
  ThreadChannel,
  DMChannel,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { discord } from "./client.js";
import { config } from "../config.js";
import { createMission, getMissionByThread } from "../missions/store.js";
import { createWorktree } from "../missions/worktree.js";
import { runCeo } from "../agents/ceo.js";
import { runLibrarian } from "../agents/librarian.js";
import { lintWiki, type LintReport } from "../tools/lint.js";
import { searchWiki, readWikiPage } from "../tools/wiki-fs.js";
import { extractPdfText } from "../tools/pdf.js";

const inflight = new Set<string>();
const activeDmMission = new Map<string, string>(); // dmChannelId → missionId

export function registerHandlers(): void {
  discord.on("messageCreate", (msg) => {
    handleMessage(msg).catch((err) => {
      console.error("[handler] error", err);
      msg.reply(`Error: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    });
  });
}

async function handleMessage(msg: Message): Promise<void> {
  console.log(
    `[msg] type=${msg.channel.type} from=${msg.author.id} (${msg.author.tag}) bot=${msg.author.bot} content="${msg.content.slice(0, 80)}"`
  );
  if (msg.author.bot) return;
  if (!config.discord.allowedUserIds.includes(msg.author.id)) {
    console.log(`[msg] dropped: user ${msg.author.id} not in allowlist ${JSON.stringify(config.discord.allowedUserIds)}`);
    return;
  }

  const chType = msg.channel.type;

  if (chType === ChannelType.DM) {
    await handleDm(msg);
    return;
  }

  if (msg.content === "/ingest" || msg.content.startsWith("/ingest ")) {
    await handleIngestInChannel(msg);
    return;
  }

  if (
    msg.content === "/lint" ||
    msg.content.startsWith("/wiki ") ||
    msg.content === "/wiki" ||
    msg.content === "/recent" ||
    msg.content.startsWith("/recent ")
  ) {
    await handleWikiQueryInChannel(msg);
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
}

async function handleDm(msg: Message): Promise<void> {
  const dm = msg.channel as DMChannel;
  const content = msg.content.trim();

  if (content === "/ingest" || content.startsWith("/ingest ")) {
    const payload = content.replace(/^\/ingest\s*/, "").trim();
    const rawAttachments = msg.attachments.map((a) => ({ name: a.name, url: a.url }));
    const attachments = await resolveAttachments(rawAttachments);
    if (!payload && attachments.length === 0) {
      await dm.send(
        "📥 `/ingest` usage: `/ingest <url>`, `/ingest <text>`, or send a markdown/text file with `/ingest` as the message."
      );
      return;
    }
    await dm.send("📚 Librarian is working…");
    try {
      const task = buildIngestTask(payload, attachments);
      const out = await runLibrarian({
        task,
        onProgress: (t) => {
          const snippet = t.slice(0, 1500);
          dm.send(`📚 **librarian:** ${snippet}`).catch(() => {});
        },
      });
      await sendLong(dm, `📚 **Librarian done:** ${out.summary}`);
    } catch (err) {
      await dm.send(`❌ Librarian failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (content === "/lint") {
    try {
      const report = lintWiki(config.swarm.wikiPath);
      await sendLong(dm, formatLintReport(report));
    } catch (err) {
      await dm.send(`❌ Lint failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (content.startsWith("/wiki ") || content === "/wiki") {
    const query = content.replace(/^\/wiki\s*/, "").trim();
    if (!query) {
      await dm.send("📖 `/wiki <query>` — usage: `/wiki acme corp`");
      return;
    }
    try {
      const hits = searchWiki(config.swarm.wikiPath, query);
      await sendLong(dm, formatSearchHits(query, hits));
    } catch (err) {
      await dm.send(`❌ Wiki search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (content === "/recent" || content.startsWith("/recent ")) {
    const arg = content.replace(/^\/recent\s*/, "").trim();
    const n = arg ? Math.min(200, Math.max(1, parseInt(arg, 10) || 20)) : 20;
    try {
      const log = readWikiPage(config.swarm.wikiPath, "log.md");
      await sendLong(dm, formatRecent(log, n));
    } catch (err) {
      await dm.send(`❌ No log found — wiki not initialized? (${err instanceof Error ? err.message : String(err)})`);
    }
    return;
  }

  if (content === "/new" || content.startsWith("/new ")) {
    activeDmMission.delete(dm.id);
    const brief = content.replace(/^\/new\s*/, "");
    if (!brief) {
      await dm.send("🆕 Ready for a new mission. Send the brief as your next message.");
      return;
    }
    await startMissionInDm(dm, brief);
    return;
  }

  const existing = activeDmMission.get(dm.id);
  if (existing) {
    await dispatchToCeo(existing, dm, content);
    return;
  }

  await startMissionInDm(dm, content);
}

async function startMissionInDm(dm: DMChannel, brief: string): Promise<void> {
  const missionId = randomUUID().slice(0, 8);
  await dm.send(`🎯 Mission \`${missionId}\` created. Spinning up worktree…`);

  try {
    const { worktreePath, branch } = await createWorktree(missionId);
    createMission({
      id: missionId,
      threadId: dm.id,
      brief,
      status: "open",
      worktreePath,
      branch,
    });
    activeDmMission.set(dm.id, missionId);
    await dm.send(`🌳 Worktree: \`${worktreePath}\` (branch \`${branch}\`)\n👔 CEO is planning…`);
    await dispatchToCeo(missionId, dm, brief);
  } catch (err) {
    await dm.send(`❌ Failed to create mission: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function startMissionInThread(msg: Message): Promise<void> {
  const parent = msg.channel as TextChannel;
  const thread = await parent.threads.create({
    name: `mission-${msg.id.slice(-6)}`,
    startMessage: msg,
    autoArchiveDuration: 1440,
  });

  const missionId = randomUUID().slice(0, 8);

  await thread.send(`🎯 Mission \`${missionId}\` created. Spinning up worktree…`);

  const { worktreePath, branch } = await createWorktree(missionId);

  createMission({
    id: missionId,
    threadId: thread.id,
    brief: msg.content,
    status: "open",
    worktreePath,
    branch,
  });

  await thread.send(`🌳 Worktree: \`${worktreePath}\` (branch \`${branch}\`)`);
  await thread.send(`👔 CEO is now planning…`);

  await dispatchToCeo(missionId, thread, msg.content);
}

async function continueMissionInThread(msg: Message): Promise<void> {
  const mission = getMissionByThread(msg.channelId);
  if (!mission) return;
  const thread = msg.channel as ThreadChannel;
  await dispatchToCeo(mission.id, thread, msg.content);
}

async function dispatchToCeo(
  missionId: string,
  channel: ThreadChannel | DMChannel,
  humanMessage: string
): Promise<void> {
  if (inflight.has(missionId)) {
    await channel.send("⏳ CEO is already working on this mission. Please wait.");
    return;
  }
  inflight.add(missionId);

  const tag = `[\`${missionId}\`]`;

  try {
    const out = await runCeo({
      missionId,
      humanMessage,
      onCeoText: () => {},
      onWorkerProgress: (role, text) => {
        const snippet = text.slice(0, 1500);
        channel.send(`${tag} **${role}**: ${snippet}`).catch(() => {});
      },
    });

    await sendLong(channel, `👔 **CEO:** ${out.reply}`);
  } finally {
    inflight.delete(missionId);
  }
}

async function sendLong(channel: { send: (content: string) => Promise<unknown> }, text: string): Promise<void> {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 1900) {
    chunks.push(rest.slice(0, 1900));
    rest = rest.slice(1900);
  }
  if (rest) chunks.push(rest);
  for (const c of chunks) await channel.send(c);
}

interface ResolvedAttachment {
  name: string | null;
  url: string;
  inlineText?: string;
}

async function resolveAttachments(
  raw: Array<{ name: string | null; url: string }>
): Promise<ResolvedAttachment[]> {
  const resolved: ResolvedAttachment[] = [];
  for (const a of raw) {
    const isPdf = a.name?.toLowerCase().endsWith(".pdf") ?? false;
    if (!isPdf) {
      resolved.push({ name: a.name, url: a.url });
      continue;
    }
    try {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`fetch ${a.url} failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await extractPdfText(buffer);
      resolved.push({ name: a.name, url: a.url, inlineText: text });
    } catch (err) {
      console.error(`[ingest] PDF extraction failed for ${a.name}:`, err instanceof Error ? err.message : err);
    }
  }
  return resolved;
}

function buildIngestTask(
  payload: string,
  attachments: ResolvedAttachment[]
): string {
  const parts: string[] = [
    "A new source has been submitted for ingestion. Follow CLAUDE.md:",
    "1. If the payload is a URL, call fetch_url to retrieve it.",
    "2. Summarize the content and create a new page under sources/ with today's date in the filename.",
    "3. Update or create relevant entity / concept / project pages.",
    "4. Append a log line for every write.",
    "5. Update index.md if you created any new top-level pages.",
    "6. Commit once with an 'ingest:' message.",
    "",
    "## Payload",
    payload || "(none — see attachments)",
  ];
  if (attachments.length > 0) {
    parts.push("", "## Attachments");
    for (const a of attachments) {
      if (a.inlineText) {
        parts.push(
          `### ${a.name ?? "(unnamed)"}`,
          `Source URL: ${a.url}`,
          "",
          "Extracted text:",
          "```",
          a.inlineText,
          "```",
          ""
        );
      } else {
        parts.push(`- ${a.name ?? "(unnamed)"}: ${a.url}`);
      }
    }
  }
  return parts.join("\n");
}

async function handleIngestInChannel(msg: Message): Promise<void> {
  const payload = msg.content.replace(/^\/ingest\s*/, "").trim();
  const rawAttachments = msg.attachments.map((a) => ({ name: a.name, url: a.url }));
  const attachments = await resolveAttachments(rawAttachments);
  if (!payload && attachments.length === 0) {
    await msg.reply(
      "📥 `/ingest` usage: `/ingest <url>`, `/ingest <text>`, or send a markdown/text file with `/ingest` as the message."
    );
    return;
  }
  await msg.reply("📚 Librarian is working…");
  try {
    const task = buildIngestTask(payload, attachments);
    const out = await runLibrarian({
      task,
      onProgress: (t) => {
        const snippet = t.slice(0, 1500);
        if (msg.channel.isTextBased() && "send" in msg.channel) {
          (msg.channel as { send: (c: string) => Promise<unknown> }).send(`📚 **librarian:** ${snippet}`).catch(() => {});
        }
      },
    });
    if (msg.channel.isTextBased() && "send" in msg.channel) {
      await sendLong(
        { send: (c: string) => (msg.channel as { send: (c: string) => Promise<unknown> }).send(c) },
        `📚 **Librarian done:** ${out.summary}`
      );
    }
  } catch (err) {
    await msg.reply(`❌ Librarian failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function formatLintReport(report: LintReport): string {
  const lines: string[] = [
    "## 🧹 Wiki lint report",
    "",
    `- orphans: **${report.orphans.length}**`,
    `- broken links: **${report.brokenLinks.length}**`,
    `- empty pages: **${report.emptyPages.length}**`,
    `- missing front-matter: **${report.missingFrontMatter.length}**`,
    "",
  ];
  if (report.orphans.length > 0) {
    lines.push("### Orphans");
    for (const p of report.orphans.slice(0, 10)) lines.push(`- \`${p}\``);
    if (report.orphans.length > 10) lines.push(`  _…and ${report.orphans.length - 10} more_`);
    lines.push("");
  }
  if (report.brokenLinks.length > 0) {
    lines.push("### Broken links");
    for (const { from, to } of report.brokenLinks.slice(0, 10)) {
      lines.push(`- \`${from}\` → \`${to}\``);
    }
    if (report.brokenLinks.length > 10) {
      lines.push(`  _…and ${report.brokenLinks.length - 10} more_`);
    }
    lines.push("");
  }
  if (report.emptyPages.length > 0) {
    lines.push("### Empty pages");
    for (const p of report.emptyPages.slice(0, 10)) lines.push(`- \`${p}\``);
    if (report.emptyPages.length > 10) lines.push(`  _…and ${report.emptyPages.length - 10} more_`);
    lines.push("");
  }
  if (report.missingFrontMatter.length > 0) {
    lines.push("### Missing front-matter");
    for (const p of report.missingFrontMatter.slice(0, 10)) lines.push(`- \`${p}\``);
    if (report.missingFrontMatter.length > 10) {
      lines.push(`  _…and ${report.missingFrontMatter.length - 10} more_`);
    }
    lines.push("");
  }
  if (
    report.orphans.length === 0 &&
    report.brokenLinks.length === 0 &&
    report.emptyPages.length === 0 &&
    report.missingFrontMatter.length === 0
  ) {
    lines.push("✨ clean");
  }
  return lines.join("\n");
}

function formatSearchHits(
  query: string,
  hits: Array<{ path: string; snippet: string }>
): string {
  if (hits.length === 0) return `🔎 \`${query}\` — no matches`;
  const capped = hits.slice(0, 10);
  const lines: string[] = [`🔎 \`${query}\` — ${hits.length} hit${hits.length === 1 ? "" : "s"}`, ""];
  for (const h of capped) {
    lines.push(`- **\`${h.path}\`**: ${h.snippet}`);
  }
  if (hits.length > 10) lines.push(`_…and ${hits.length - 10} more_`);
  return lines.join("\n");
}

function formatRecent(log: string, n: number): string {
  const allLines = log.split("\n").filter((l) => l.trim().length > 0 && l !== "---");
  const bodyLines = allLines.filter((l) => !l.startsWith("#"));
  const tail = bodyLines.slice(-n);
  if (tail.length === 0) return "📜 log is empty";
  return ["📜 last " + tail.length + " entries", "```", ...tail, "```"].join("\n");
}

async function handleWikiQueryInChannel(msg: Message): Promise<void> {
  const content = msg.content;
  try {
    if (content === "/lint") {
      const report = lintWiki(config.swarm.wikiPath);
      await msg.reply(formatLintReport(report));
      return;
    }
    if (content.startsWith("/wiki ") || content === "/wiki") {
      const query = content.replace(/^\/wiki\s*/, "").trim();
      if (!query) {
        await msg.reply("📖 `/wiki <query>` — usage: `/wiki acme corp`");
        return;
      }
      const hits = searchWiki(config.swarm.wikiPath, query);
      await msg.reply(formatSearchHits(query, hits));
      return;
    }
    if (content === "/recent" || content.startsWith("/recent ")) {
      const arg = content.replace(/^\/recent\s*/, "").trim();
      const n = arg ? Math.min(200, Math.max(1, parseInt(arg, 10) || 20)) : 20;
      const log = readWikiPage(config.swarm.wikiPath, "log.md");
      await msg.reply(formatRecent(log, n));
      return;
    }
  } catch (err) {
    await msg.reply(`❌ ${err instanceof Error ? err.message : String(err)}`);
  }
}
