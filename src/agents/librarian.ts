import { query } from "@anthropic-ai/claude-agent-sdk";
import { LIBRARIAN_SYSTEM_PROMPT } from "./prompts.js";
import { buildLibrarianMcpServer } from "../tools/wiki.js";
import { config } from "../config.js";

export interface LibrarianInput {
  task: string;
  onProgress?: (text: string) => void;
}

export interface LibrarianOutput {
  summary: string;
  sessionId: string;
}

export async function runLibrarian(input: LibrarianInput): Promise<LibrarianOutput> {
  const mcpServer = buildLibrarianMcpServer();

  const result = query({
    prompt: input.task,
    options: {
      systemPrompt: LIBRARIAN_SYSTEM_PROMPT,
      cwd: config.swarm.wikiPath,
      mcpServers: { "swarm-wiki": mcpServer },
      allowedTools: [
        "mcp__swarm-wiki__read_wiki_page",
        "mcp__swarm-wiki__list_wiki_pages",
        "mcp__swarm-wiki__search_wiki",
        "mcp__swarm-wiki__write_wiki_page",
        "mcp__swarm-wiki__append_wiki_log",
        "mcp__swarm-wiki__commit_wiki",
        "mcp__swarm-wiki__fetch_url",
      ],
      permissionMode: "acceptEdits",
    },
  });

  let summary = "";
  let sessionId = "";

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

  return { summary, sessionId };
}
