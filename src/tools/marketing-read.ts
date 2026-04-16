import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileP = promisify(execFile);

const ALLOWED_PREFIXES = [
  "/2/users/me",
  "/2/users/",
  "/2/tweets/search",
  "/2/tweets/",
];

function isAllowed(endpoint: string): boolean {
  if (!endpoint.startsWith("/")) return false;
  return ALLOWED_PREFIXES.some((p) => endpoint.startsWith(p));
}

export function buildMarketingReadMcpServer() {
  const xurlGet = tool(
    "xurl_get",
    "Read-only GET against the Twitter v2 API via xurl. Only allowlisted endpoints.",
    { endpoint: z.string().describe("e.g. /2/users/me") },
    async (args) => {
      if (!isAllowed(args.endpoint)) {
        throw new Error(`xurl_get: endpoint not in allowlist: ${args.endpoint}`);
      }
      const res = await execFileP(config.swarm.xurlPath, [args.endpoint], {
        timeout: 15_000,
      });
      return {
        content: [{ type: "text" as const, text: res.stdout.slice(0, 20_000) }],
      };
    },
  );

  return createSdkMcpServer({
    name: "swarm-marketing-read",
    version: "0.1.0",
    tools: [xurlGet],
  });
}
