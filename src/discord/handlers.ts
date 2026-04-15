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
    const attachments = msg.attachments.map((a) => ({ name: a.name, url: a.url }));
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

function buildIngestTask(
  payload: string,
  attachments: { name: string | null; url: string }[]
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
      parts.push(`- ${a.name ?? "(unnamed)"}: ${a.url}`);
    }
  }
  return parts.join("\n");
}

async function handleIngestInChannel(msg: Message): Promise<void> {
  const payload = msg.content.replace(/^\/ingest\s*/, "").trim();
  const attachments = msg.attachments.map((a) => ({ name: a.name, url: a.url }));
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
