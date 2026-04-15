import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const REQUIRED_VARS = [
  "DISCORD_TOKEN",
  "DISCORD_CEO_CHANNEL_ID",
  "DISCORD_ALLOWED_USER_IDS",
  "ANTHROPIC_API_KEY",
  "SWARM_REPO_PATH",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  vi.resetModules();
  saved = {};
  for (const name of REQUIRED_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("lazy config", () => {
  it("can be imported with no required env vars set", async () => {
    await expect(import("../src/config.js")).resolves.toBeDefined();
  });

  it("throws on first read of a missing required field", async () => {
    const mod = await import("../src/config.js");
    expect(() => mod.config.discord.token).toThrow(/DISCORD_TOKEN/);
  });

  it("validateConfig throws if any required var is missing", async () => {
    const mod = await import("../src/config.js");
    expect(() => mod.validateConfig()).toThrow(/DISCORD_TOKEN|DISCORD_CEO_CHANNEL_ID|ANTHROPIC_API_KEY|SWARM_REPO_PATH/);
  });

  it("caches the value once read", async () => {
    process.env.DISCORD_TOKEN = "t1";
    process.env.DISCORD_CEO_CHANNEL_ID = "c1";
    process.env.DISCORD_ALLOWED_USER_IDS = "u1";
    process.env.ANTHROPIC_API_KEY = "k1";
    process.env.SWARM_REPO_PATH = "/tmp/repo";
    const mod = await import("../src/config.js");
    const first = mod.config.discord.token;
    process.env.DISCORD_TOKEN = "t2";
    const second = mod.config.discord.token;
    expect(first).toBe("t1");
    expect(second).toBe("t1");
  });
});
