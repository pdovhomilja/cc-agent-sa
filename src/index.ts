import { startDiscord, discord } from "./discord/client.js";
import { registerHandlers } from "./discord/handlers.js";

process.on("uncaughtException", (err) => {
  console.error("[swarm] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[swarm] unhandledRejection:", reason);
});

discord.on("error", (err) => console.error("[discord] client error:", err));
discord.on("shardError", (err) => console.error("[discord] shard error:", err));
discord.on("shardDisconnect", (_ev, id) => console.warn(`[discord] shard ${id} disconnected`));
discord.on("shardReconnecting", (id) => console.log(`[discord] shard ${id} reconnecting…`));
discord.on("shardResume", (id) => console.log(`[discord] shard ${id} resumed`));

async function main(): Promise<void> {
  registerHandlers();
  await startDiscord();
  console.log("[swarm] ready — waiting for missions in the CEO channel");
}

main().catch((err) => {
  console.error("[swarm] fatal", err);
  process.exit(1);
});
