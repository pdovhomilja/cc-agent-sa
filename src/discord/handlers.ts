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
