import fs from "node:fs";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { loadRegistry, type Registry } from "./registry.js";
import { composePrompt } from "./compose-prompt.js";
import { buildWikiReaderMcpServer, buildLibrarianMcpServer } from "../tools/wiki.js";
import { buildPersonalToolsMcpServer } from "../tools/personal.js";
import { getSession, saveSession } from "../missions/store.js";

// ---------------------------------------------------------------------------
// Registry (lazy singleton)
// ---------------------------------------------------------------------------

let _registry: Registry | undefined;

export function getRegistry(): Registry {
  if (!_registry) {
    _registry = loadRegistry(path.resolve("agents"));
  }
  return _registry;
}

// ---------------------------------------------------------------------------
// Shared skills loader
// ---------------------------------------------------------------------------

function loadSharedSkills(): string[] {
  const dir = path.resolve("skills/shared");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RunAgentInput {
  agentId: string;
  missionId: string;
  task: string;
  onProgress?: (text: string) => void;
  extraMcpServers?: Record<string, unknown>;
  extraAllowedTools?: string[];
}

export interface RunAgentOutput {
  summary: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
  const registry = getRegistry();
  const entry = registry.agents.get(input.agentId);
  if (!entry) {
    throw new Error(`Agent not found in registry: ${input.agentId}`);
  }

  // Resume support
  const resume = getSession(input.missionId, input.agentId);

  // System prompt
  const systemPrompt = composePrompt({
    roleMd: entry.roleMd,
    sharedSkills: loadSharedSkills(),
    claudeMd: entry.claudeMd,
  });

  // MCP servers
  const mcpServers: Record<string, unknown> = {};
  const allowedTools: string[] = [];

  // Always: wiki reader
  mcpServers["swarm-wiki-read"] = buildWikiReaderMcpServer();
  allowedTools.push(
    "mcp__swarm-wiki-read__read_wiki_page",
    "mcp__swarm-wiki-read__list_wiki_pages",
    "mcp__swarm-wiki-read__search_wiki",
  );

  // Conditional: librarian MCP (fetch_url)
  if (entry.config.mcpTools.includes("fetch_url")) {
    mcpServers["swarm-wiki"] = buildLibrarianMcpServer();
    allowedTools.push("mcp__swarm-wiki__fetch_url");
  }

  // Always: personal tools
  const personalName = `swarm-personal-${input.agentId}`;
  mcpServers[personalName] = buildPersonalToolsMcpServer(input.agentId, input.missionId);
  allowedTools.push(
    `mcp__${personalName}__read_scratchpad`,
    `mcp__${personalName}__write_scratchpad`,
    `mcp__${personalName}__append_scratchpad`,
    `mcp__${personalName}__list_scratchpad`,
  );

  // Conditional: submit_to_librarian
  if (entry.config.mcpTools.includes("submit_to_librarian")) {
    allowedTools.push(`mcp__${personalName}__submit_to_librarian`);
  }

  // Merge extras
  if (input.extraMcpServers) {
    Object.assign(mcpServers, input.extraMcpServers);
  }
  if (input.extraAllowedTools) {
    allowedTools.push(...input.extraAllowedTools);
  }

  // Native tools
  allowedTools.push(...entry.config.nativeTools);

  // Permission mode
  const permissionMode = entry.config.nativeTools.includes("Write")
    ? "acceptEdits"
    : "default";

  // Run query
  const result = query({
    prompt: input.task,
    options: {
      systemPrompt,
      model: entry.config.model,
      cwd: config.swarm.wikiPath,
      mcpServers: mcpServers as any,
      allowedTools,
      permissionMode: permissionMode as any,
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

  saveSession({ missionId: input.missionId, role: input.agentId, sessionId });
  return { summary, sessionId };
}
