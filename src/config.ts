import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    ceoChannelId: required("DISCORD_CEO_CHANNEL_ID"),
    workshopChannelId: required("DISCORD_WORKSHOP_CHANNEL_ID"),
    allowedUserIds: required("DISCORD_ALLOWED_USER_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  swarm: {
    repoPath: path.resolve(required("SWARM_REPO_PATH")),
    worktreeRoot: path.resolve(process.env.SWARM_WORKTREE_ROOT ?? "./worktrees"),
    dbPath: path.resolve(process.env.SWARM_DB_PATH ?? "./data/swarm.db"),
    missionTimeoutMs: Number(process.env.SWARM_MISSION_TIMEOUT_MS ?? 30 * 60 * 1000),
  },
} as const;
