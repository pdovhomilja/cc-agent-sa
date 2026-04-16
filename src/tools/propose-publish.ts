import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import { readDraft, transitionDraft } from "./drafts-fs.js";
import { approvalStore } from "../publisher/approval-store.js";
import { discord } from "../discord/client.js";
import { ChannelType, TextChannel } from "discord.js";

function findMarketingChannelId(): string | undefined {
  for (const [channelId, dept] of config.discord.departmentChannels) {
    if (dept === "marketing") return channelId;
  }
  return undefined;
}

export function buildProposePublishMcpServer() {
  const proposePublish = tool(
    "propose_publish",
    "Transition a draft to awaiting-approval and post it to the marketing channel for human review.",
    {
      draftId: z.string().describe("The draft ID"),
      platform: z.enum(["x", "linkedin"]).describe("Target platform"),
    },
    async (args) => {
      const marketingChannelId = findMarketingChannelId();
      if (!marketingChannelId) {
        throw new Error("propose_publish: no marketing channel configured in departmentChannels");
      }

      const draft = readDraft(config.swarm.wikiPath, args.draftId);
      if (draft.frontmatter.status !== "ready-for-review") {
        throw new Error(
          `propose_publish: draft ${args.draftId} status is "${draft.frontmatter.status}", expected "ready-for-review"`,
        );
      }

      transitionDraft(config.swarm.wikiPath, args.draftId, "awaiting-approval");

      const channel = await discord.channels.fetch(marketingChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("propose_publish: marketing channel not found or not a text channel");
      }

      const textChannel = channel as TextChannel;
      const sent = await textChannel.send(
        `**Draft \`${args.draftId}\` (${args.platform})** awaiting approval:\n\`\`\`\n${draft.frontmatter.post_text.slice(0, 1800)}\n\`\`\`\nReact \u2705 to publish, \u274c to reject.`,
      );

      approvalStore().insert({
        messageId: sent.id,
        draftId: args.draftId,
        platform: args.platform,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Draft ${args.draftId} proposed for ${args.platform}. Approval message: ${sent.id}`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "swarm-marketing-propose",
    version: "0.1.0",
    tools: [proposePublish],
  });
}
