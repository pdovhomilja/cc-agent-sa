import { query } from "@anthropic-ai/claude-agent-sdk";
import { CEO_SYSTEM_PROMPT } from "./prompts.js";
import { buildDelegateMcpServer, type DelegateContext } from "../tools/delegate.js";
import { buildWikiReaderMcpServer } from "../tools/wiki.js";
import { buildPersonalToolsMcpServer } from "../tools/personal.js";
import { getSession, saveSession } from "../missions/store.js";

export interface CeoInput {
  missionId: string;
  humanMessage: string;
  onCeoText: (text: string) => void;
  onWorkerProgress: (role: "coder" | "reviewer" | "librarian", text: string) => void;
}

export interface CeoOutput {
  reply: string;
  sessionId: string;
}

export async function runCeo(input: CeoInput): Promise<CeoOutput> {
  const resume = getSession(input.missionId, "ceo");

  const ctx: DelegateContext = {
    missionId: input.missionId,
    onWorkerProgress: input.onWorkerProgress,
  };

  const mcpServer = buildDelegateMcpServer(ctx);
  const wikiReader = buildWikiReaderMcpServer();
  const personal = buildPersonalToolsMcpServer("ceo", input.missionId);

  const result = query({
    prompt: input.humanMessage,
    options: {
      systemPrompt: CEO_SYSTEM_PROMPT,
      mcpServers: {
        "swarm-delegate": mcpServer,
        "swarm-wiki-read": wikiReader,
        "swarm-personal-ceo": personal,
      },
      allowedTools: [
        "mcp__swarm-delegate__delegate_to_coder",
        "mcp__swarm-delegate__delegate_to_reviewer",
        "mcp__swarm-delegate__delegate_to_librarian",
        "mcp__swarm-wiki-read__read_wiki_page",
        "mcp__swarm-wiki-read__list_wiki_pages",
        "mcp__swarm-wiki-read__search_wiki",
        "mcp__swarm-personal-ceo__read_scratchpad",
        "mcp__swarm-personal-ceo__write_scratchpad",
        "mcp__swarm-personal-ceo__append_scratchpad",
        "mcp__swarm-personal-ceo__list_scratchpad",
        "mcp__swarm-personal-ceo__submit_to_librarian",
      ],
      permissionMode: "default",
      resume,
    },
  });

  let reply = "";
  let sessionId = resume ?? "";

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          reply += block.text;
          input.onCeoText(block.text);
        }
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") reply = msg.result;
      sessionId = msg.session_id;
    }
  }

  saveSession({ missionId: input.missionId, role: "ceo", sessionId });
  return { reply, sessionId };
}
