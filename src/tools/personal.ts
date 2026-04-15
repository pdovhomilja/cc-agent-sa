import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";
import {
  readScratchpad,
  writeScratchpad,
  appendScratchpad,
  listScratchpad,
} from "./scratchpad-fs.js";
import { submitToInbox } from "./submit-inbox.js";

export function buildPersonalToolsMcpServer(role: string, missionId: string | null) {
  const readTool = tool(
    "read_scratchpad",
    "Read one of your own scratchpad files. Scratchpads are your private role-scoped notes — other agents cannot see them.",
    { filename: z.string().describe("Filename relative to your scratchpad dir, e.g. 'observations.md'.") },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: readScratchpad(config.swarm.scratchpadRoot, role, args.filename),
        },
      ],
    })
  );

  const writeTool = tool(
    "write_scratchpad",
    "Create or overwrite one of your own scratchpad files.",
    {
      filename: z.string().describe("Filename relative to your scratchpad dir."),
      content: z.string().describe("Full file content (markdown)."),
    },
    async (args) => {
      const rel = writeScratchpad(
        config.swarm.scratchpadRoot,
        role,
        args.filename,
        args.content
      );
      return { content: [{ type: "text" as const, text: `wrote ${rel}` }] };
    }
  );

  const appendTool = tool(
    "append_scratchpad",
    "Append content to one of your own scratchpad files. Creates the file if missing.",
    {
      filename: z.string().describe("Filename relative to your scratchpad dir."),
      content: z.string().describe("Text to append. Include a trailing newline."),
    },
    async (args) => {
      appendScratchpad(config.swarm.scratchpadRoot, role, args.filename, args.content);
      return { content: [{ type: "text" as const, text: `appended to ${args.filename}` }] };
    }
  );

  const listTool = tool(
    "list_scratchpad",
    "List the markdown files in your own scratchpad directory.",
    {},
    async () => {
      const files = listScratchpad(config.swarm.scratchpadRoot, role);
      return {
        content: [
          { type: "text" as const, text: files.length ? files.join("\n") : "(empty)" },
        ],
      };
    }
  );

  const submitTool = tool(
    "submit_to_librarian",
    "Submit a durable finding, fact, or observation for the Librarian to file into the wiki. Fire-and-forget — the note lands in wiki/inbox/ and the Librarian will process it the next time it runs. Use for anything worth remembering beyond this mission.",
    {
      note: z.string().describe("The note content in markdown. Be specific and self-contained."),
    },
    async (args) => {
      const filename = submitToInbox(config.swarm.wikiPath, {
        role,
        missionId,
        note: args.note,
      });
      return { content: [{ type: "text" as const, text: `submitted to ${filename}` }] };
    }
  );

  return createSdkMcpServer({
    name: `swarm-personal-${role}`,
    version: "0.1.0",
    tools: [readTool, writeTool, appendTool, listTool, submitTool],
  });
}
