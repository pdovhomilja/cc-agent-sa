import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config.js";

export const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

export async function startDiscord(): Promise<void> {
  await discord.login(config.discord.token);
  await new Promise<void>((resolve) => discord.once("clientReady", () => resolve()));
  console.log(`[discord] logged in as ${discord.user?.tag}`);
}
