import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config.js";

export const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

export async function startDiscord(): Promise<void> {
  await discord.login(config.discord.token);
  await new Promise<void>((resolve) => discord.once("clientReady", () => resolve()));
  console.log(`[discord] logged in as ${discord.user?.tag}`);

  for (const userId of config.discord.allowedUserIds) {
    try {
      const user = await discord.users.fetch(userId);
      const dm = await user.createDM();
      await dm.send("👋 CC-CEO online. Reply here to start a mission, or type `/new <brief>` for a fresh one.");
      console.log(`[discord] opened DM with ${user.tag} (channel ${dm.id})`);
    } catch (err) {
      console.error(`[discord] failed to DM ${userId}:`, err instanceof Error ? err.message : err);
    }
  }
}
