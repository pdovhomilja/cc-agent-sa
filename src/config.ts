import "dotenv/config";
import path from "node:path";

function parseDepartmentChannels(raw?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const [channelId, dept] = pair.split(":").map((s) => s.trim());
    if (channelId && dept) map.set(channelId, dept);
  }
  return map;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    ceoChannelId: required("DISCORD_CEO_CHANNEL_ID"),
    workshopChannelId: process.env.DISCORD_WORKSHOP_CHANNEL_ID || required("DISCORD_CEO_CHANNEL_ID"),
    allowedUserIds: required("DISCORD_ALLOWED_USER_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    departmentChannels: parseDepartmentChannels(process.env.DISCORD_DEPARTMENT_CHANNELS),
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
    missionTimeoutMs: Number(process.env.SWARM_MISSION_TIMEOUT_MS ?? 30 * 60 * 1000),
    xurlPath: process.env.XURL_PATH ?? "xurl",
  },
};
