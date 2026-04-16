import type { Client, MessageReaction, PartialMessageReaction, User, PartialUser } from "discord.js";
import { config } from "../config.js";
import { approvalStore } from "./approval-store.js";
import { postToX } from "./xurl.js";
import { readDraft, transitionDraft } from "../tools/drafts-fs.js";

export function registerApprovalHandler(client: Client): void {
  client.on("messageReactionAdd", (reaction, user) => {
    handleReaction(reaction, user).catch((err) => console.error("[approval] error", err));
  });
}

async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Ignore bots
  if (user.bot) return;

  // Ignore non-allowlisted users
  if (!config.discord.allowedUserIds.includes(user.id)) return;

  // Ignore non ✅/❌ emoji
  const emoji = reaction.emoji.name;
  if (emoji !== "✅" && emoji !== "❌") return;

  // Fetch partials if needed
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();

  const messageId = reaction.message.id;
  const row = approvalStore().get(messageId);
  if (!row) return; // Not an approval message

  const { draftId, platform } = row;
  const channel = reaction.message.channel;

  if (emoji === "❌") {
    try {
      transitionDraft(config.swarm.wikiPath, draftId, "rejected");
      approvalStore().delete(messageId);
      if (channel.isSendable()) {
        await channel.send(`❌ Draft \`${draftId}\` rejected.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (channel.isSendable()) {
        await channel.send(`⚠️ Error rejecting draft \`${draftId}\`: ${msg}`);
      }
    }
    return;
  }

  // ✅ — publish
  if (platform === "linkedin") {
    if (channel.isSendable()) {
      await channel.send("LinkedIn publishing not implemented yet.");
    }
    return;
  }

  try {
    const draft = readDraft(config.swarm.wikiPath, draftId);
    const { url } = await postToX(
      { text: draft.frontmatter.post_text },
      { xurlPath: config.swarm.xurlPath },
    );
    transitionDraft(config.swarm.wikiPath, draftId, "published", {
      published_url: url,
      published_at: new Date().toISOString(),
    });
    approvalStore().delete(messageId);
    if (channel.isSendable()) {
      await channel.send(`✅ Published! ${url}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (channel.isSendable()) {
      await channel.send(`⚠️ Error publishing draft \`${draftId}\`: ${msg}`);
    }
  }
}
