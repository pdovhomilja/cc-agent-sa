import { startDiscord } from "./discord/client.js";
import { registerHandlers } from "./discord/handlers.js";

async function main(): Promise<void> {
  registerHandlers();
  await startDiscord();
  console.log("[swarm] ready — waiting for missions in the CEO channel");
}

main().catch((err) => {
  console.error("[swarm] fatal", err);
  process.exit(1);
});
