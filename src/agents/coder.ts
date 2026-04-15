import { query } from "@anthropic-ai/claude-agent-sdk";
import { CODER_SYSTEM_PROMPT } from "./prompts.js";
import { buildWikiReaderMcpServer } from "../tools/wiki.js";
import { getSession, saveSession } from "../missions/store.js";

export interface CoderInput {
  missionId: string;
  worktreePath: string;
  brief: string;
  onProgress?: (text: string) => void;
}

export interface CoderOutput {
  summary: string;
  sessionId: string;
}

export async function runCoder(input: CoderInput): Promise<CoderOutput> {
  const resume = getSession(input.missionId, "coder");
  const wikiReader = buildWikiReaderMcpServer();

  const result = query({
    prompt: input.brief,
    options: {
      systemPrompt: CODER_SYSTEM_PROMPT,
      cwd: input.worktreePath,
      mcpServers: { "swarm-wiki-read": wikiReader },
      allowedTools: [
        "Read", "Write", "Edit", "Glob", "Grep", "Bash",
        "mcp__swarm-wiki-read__read_wiki_page",
        "mcp__swarm-wiki-read__list_wiki_pages",
        "mcp__swarm-wiki-read__search_wiki",
      ],
      permissionMode: "acceptEdits",
      resume,
    },
  });

  let summary = "";
  let sessionId = resume ?? "";

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
    }
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          summary += block.text;
          input.onProgress?.(block.text);
        }
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") summary = msg.result;
      sessionId = msg.session_id;
    }
  }

  saveSession({ missionId: input.missionId, role: "coder", sessionId });
  return { summary, sessionId };
}
