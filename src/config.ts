import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function envOnce<T>(read: () => T): () => T {
  let cached: { value: T } | null = null;
  return () => {
    if (!cached) cached = { value: read() };
    return cached.value;
  };
}

const discordToken = envOnce(() => required("DISCORD_TOKEN"));
const ceoChannelId = envOnce(() => required("DISCORD_CEO_CHANNEL_ID"));
const workshopChannelId = envOnce(() =>
  process.env.DISCORD_WORKSHOP_CHANNEL_ID || required("DISCORD_CEO_CHANNEL_ID")
);
const allowedUserIds = envOnce(() =>
  required("DISCORD_ALLOWED_USER_IDS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const anthropicApiKey = envOnce(() => required("ANTHROPIC_API_KEY"));
const repoPath = envOnce(() => path.resolve(required("SWARM_REPO_PATH")));
const worktreeRoot = envOnce(() =>
  path.resolve(process.env.SWARM_WORKTREE_ROOT ?? "./worktrees")
);
const dbPath = envOnce(() =>
  path.resolve(process.env.SWARM_DB_PATH ?? "./data/swarm.db")
);
const wikiPath = envOnce(() =>
  path.resolve(process.env.SWARM_WIKI_PATH ?? "./wiki")
);
const scratchpadRoot = envOnce(() =>
  path.resolve(process.env.SWARM_SCRATCHPAD_ROOT ?? "./scratchpads")
);
const missionTimeoutMs = envOnce(() =>
  Number(process.env.SWARM_MISSION_TIMEOUT_MS ?? 30 * 60 * 1000)
);
const librarianTimeoutMs = envOnce(() =>
  Number(process.env.SWARM_LIBRARIAN_TIMEOUT_MS ?? 10 * 60 * 1000)
);

export const config = {
  discord: {
    get token() {
      return discordToken();
    },
    get ceoChannelId() {
      return ceoChannelId();
    },
    get workshopChannelId() {
      return workshopChannelId();
    },
    get allowedUserIds() {
      return allowedUserIds();
    },
  },
  anthropic: {
    get apiKey() {
      return anthropicApiKey();
    },
  },
  swarm: {
    get repoPath() {
      return repoPath();
    },
    get worktreeRoot() {
      return worktreeRoot();
    },
    get dbPath() {
      return dbPath();
    },
    get wikiPath() {
      return wikiPath();
    },
    get scratchpadRoot() {
      return scratchpadRoot();
    },
    get missionTimeoutMs() {
      return missionTimeoutMs();
    },
    get librarianTimeoutMs() {
      return librarianTimeoutMs();
    },
  },
};

export function validateConfig(): void {
  void config.discord.token;
  void config.discord.ceoChannelId;
  void config.discord.workshopChannelId;
  void config.discord.allowedUserIds;
  void config.anthropic.apiKey;
  void config.swarm.repoPath;
  void config.swarm.worktreeRoot;
  void config.swarm.dbPath;
  void config.swarm.wikiPath;
  void config.swarm.scratchpadRoot;
  void config.swarm.missionTimeoutMs;
  void config.swarm.librarianTimeoutMs;
}
