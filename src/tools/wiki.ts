import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import {
  readWikiPage,
  writeWikiPage,
  listWikiPages,
  searchWiki,
  appendWikiLog,
} from "./wiki-fs.js";
import { commitWiki } from "./wiki-git.js";

const WIKI = () => config.swarm.wikiPath;

const readPage = tool(
  "read_wiki_page",
  "Read a single markdown page from the wiki. Path is relative to the wiki root.",
  { path: z.string().describe("Relative path, e.g. 'entities/acme.md'.") },
  async (args) => ({
    content: [{ type: "text" as const, text: readWikiPage(WIKI(), args.path) }],
  })
);

const listPages = tool(
  "list_wiki_pages",
  "List all markdown pages in the wiki, optionally scoped to a subdirectory.",
  { subdir: z.string().optional().describe("Optional subdirectory like 'entities'.") },
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: listWikiPages(WIKI(), args.subdir).join("\n") || "(no pages)",
      },
    ],
  })
);

const search = tool(
  "search_wiki",
  "Case-insensitive substring search across all wiki pages. Returns matching paths and snippets.",
  { query: z.string().describe("Substring to search for.") },
  async (args) => {
    const hits = searchWiki(WIKI(), args.query);
    const text = hits.length
      ? hits.map((h) => `- ${h.path}: ${h.snippet}`).join("\n")
      : "(no matches)";
    return { content: [{ type: "text" as const, text }] };
  }
);

const writePage = tool(
  "write_wiki_page",
  "Create or overwrite a wiki page. Librarian-only.",
  {
    path: z.string().describe("Relative path, e.g. 'entities/acme.md'."),
    content: z.string().describe("Full markdown content including YAML front-matter."),
  },
  async (args) => {
    writeWikiPage(WIKI(), args.path, args.content);
    return { content: [{ type: "text" as const, text: `wrote ${args.path}` }] };
  }
);

const appendLog = tool(
  "append_wiki_log",
  "Append one log line to log.md. Use the format 'YYYY-MM-DD HH:MM | ACTION | path | summary'.",
  { entry: z.string().describe("The log line (no trailing newline needed).") },
  async (args) => {
    appendWikiLog(WIKI(), args.entry);
    return { content: [{ type: "text" as const, text: "logged" }] };
  }
);

const commit = tool(
  "commit_wiki",
  "Stage and commit all pending changes in the wiki repo with the given message. Call exactly once at the end of a task.",
  { message: z.string().describe("Commit message following the schema in CLAUDE.md.") },
  async (args) => {
    const hash = await commitWiki(WIKI(), args.message);
    return { content: [{ type: "text" as const, text: `commit: ${hash}` }] };
  }
);

const fetchUrl = tool(
  "fetch_url",
  "Fetch a URL and return its text content. Use for ingesting external sources.",
  { url: z.string().url().describe("The URL to fetch.") },
  async (args) => {
    const res = await fetch(args.url);
    if (!res.ok) throw new Error(`fetch ${args.url} failed: ${res.status}`);
    const text = await res.text();
    return { content: [{ type: "text" as const, text: text.slice(0, 50_000) }] };
  }
);

export function buildLibrarianMcpServer() {
  return createSdkMcpServer({
    name: "swarm-wiki",
    version: "0.1.0",
    tools: [readPage, listPages, search, writePage, appendLog, commit, fetchUrl],
  });
}

export function buildWikiReaderMcpServer() {
  return createSdkMcpServer({
    name: "swarm-wiki-read",
    version: "0.1.0",
    tools: [readPage, listPages, search],
  });
}
