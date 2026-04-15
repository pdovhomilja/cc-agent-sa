import { type Message, ChannelType, TextChannel, ThreadChannel } from "discord.js";
import { randomUUID } from "node:crypto";
import { discord } from "./client.js";
import { config } from "../config.js";
import { createMission, getMissionByThread } from "../missions/store.js";
import { createWorktree } from "../missions/worktree.js";
import { runCeo } from "../agents/ceo.js";

const inflight = new Set<string>();

export function registerHandlers(): void {
  discord.on("messageCreate", (msg) => {
    handleMessage(msg).catch((err) => {
      console.error("[handler] error", err);
      msg.reply(`Error: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    });
  });
}

async function handleMessage(msg: Message): Promise<void> {
  if (msg.author.bot) return;
  if (!config.discord.allowedUserIds.includes(msg.author.id)) return;

  const inCeoChannel = msg.channelId === config.discord.ceoChannelId;
  const inMissionThread =
    msg.channel.type === ChannelType.PublicThread &&
    (msg.channel as ThreadChannel).parentId === config.discord.ceoChannelId;

  if (!inCeoChannel && !inMissionThread) return;

  if (inCeoChannel) {
    await startMission(msg);
    return;
  }

  await continueMission(msg);
}

async function startMission(msg: Message): Promise<void> {
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

async function continueMission(msg: Message): Promise<void> {
  const mission = getMissionByThread(msg.channelId);
  if (!mission) return;
  const thread = msg.channel as ThreadChannel;
  await dispatchToCeo(mission.id, thread, msg.content);
}

async function dispatchToCeo(missionId: string, thread: ThreadChannel, humanMessage: string): Promise<void> {
  if (inflight.has(missionId)) {
    await thread.send("⏳ CEO is already working on this mission. Please wait.");
    return;
  }
  inflight.add(missionId);

  const workshop = (await discord.channels.fetch(config.discord.workshopChannelId)) as TextChannel | null;
  const tag = `[\`${missionId}\`]`;

  try {
    const out = await runCeo({
      missionId,
      humanMessage,
      onCeoText: () => {},
      onWorkerProgress: (role, text) => {
        const snippet = text.slice(0, 1500);
        workshop?.send(`${tag} **${role}**: ${snippet}`).catch(() => {});
      },
    });

    await sendLong(thread, `👔 **CEO:** ${out.reply}`);
  } finally {
    inflight.delete(missionId);
  }
}

async function sendLong(channel: ThreadChannel, text: string): Promise<void> {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 1900) {
    chunks.push(rest.slice(0, 1900));
    rest = rest.slice(1900);
  }
  if (rest) chunks.push(rest);
  for (const c of chunks) await channel.send(c);
}
