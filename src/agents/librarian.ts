import { query } from "@anthropic-ai/claude-agent-sdk";
import { LIBRARIAN_SYSTEM_PROMPT } from "./prompts.js";
import { buildLibrarianMcpServer } from "../tools/wiki.js";
import { config } from "../config.js";

export class LibrarianTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Librarian session timed out after ${timeoutMs}ms`);
    this.name = "LibrarianTimeoutError";
  }
}

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
      permissionMode: "default",
    },
  });

  const timeoutMs = config.swarm.librarianTimeoutMs;
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new LibrarianTimeoutError(timeoutMs)),
      timeoutMs
    );
    timeoutHandle.unref();
  });

  const runPromise = (async (): Promise<LibrarianOutput> => {
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
  })();

  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
