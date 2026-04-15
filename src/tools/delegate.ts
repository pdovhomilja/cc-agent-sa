import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { runCoder } from "../agents/coder.js";
import { runReviewer } from "../agents/reviewer.js";
import { runLibrarian } from "../agents/librarian.js";
import { getMission, updateMissionStatus } from "../missions/store.js";
import { getDiff } from "../missions/worktree.js";
import { captureMissionInBackground } from "../missions/capture.js";

export interface DelegateContext {
  missionId: string;
  onWorkerProgress: (role: "coder" | "reviewer" | "librarian", text: string) => void;
}

export function buildDelegateMcpServer(ctx: DelegateContext) {
  const delegateToCoder = tool(
    "delegate_to_coder",
    "Delegate an implementation task to the Coder agent. The Coder writes/edits code in the mission worktree and returns a summary of changes.",
    {
      objective: z.string().describe("One sentence describing what must be true when done."),
      constraints: z.string().describe("Existing style, APIs, files that must NOT be touched."),
      success_criteria: z.string().describe("How we verify completion: tests, type-check, specific output."),
      details: z.string().describe("Additional context, file hints, acceptance notes."),
    },
    async (args) => {
      const mission = getMission(ctx.missionId);
      if (!mission) throw new Error(`Mission ${ctx.missionId} not found`);
      updateMissionStatus(mission.id, "coding");

      const brief = [
        `# Objective`,
        args.objective,
        ``,
        `# Constraints`,
        args.constraints,
        ``,
        `# Success criteria`,
        args.success_criteria,
        ``,
        `# Details`,
        args.details,
      ].join("\n");

      const out = await runCoder({
        missionId: mission.id,
        worktreePath: mission.worktreePath,
        brief,
        onProgress: (t) => ctx.onWorkerProgress("coder", t),
      });

      const diff = await getDiff(mission.worktreePath);
      return {
        content: [
          {
            type: "text" as const,
            text: `## Coder summary\n${out.summary}\n\n## Diff\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``,
          },
        ],
      };
    }
  );

  const delegateToReviewer = tool(
    "delegate_to_reviewer",
    "Delegate quality review to the Reviewer agent. Pass the original mission brief. The Reviewer returns APPROVE or REJECT with reasoning.",
    {
      original_brief: z.string().describe("The original mission brief from the human, verbatim."),
    },
    async (args) => {
      const mission = getMission(ctx.missionId);
      if (!mission) throw new Error(`Mission ${ctx.missionId} not found`);
      updateMissionStatus(mission.id, "reviewing");

      const diff = await getDiff(mission.worktreePath);
      const out = await runReviewer({
        missionId: mission.id,
        worktreePath: mission.worktreePath,
        brief: args.original_brief,
        diff,
        onProgress: (t) => ctx.onWorkerProgress("reviewer", t),
      });

      updateMissionStatus(mission.id, out.verdict === "APPROVE" ? "awaiting_approval" : "coding");
      if (out.verdict === "APPROVE") {
        captureMissionInBackground(mission.id);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `## Reviewer verdict: ${out.verdict}\n\n${out.notes}`,
          },
        ],
      };
    }
  );

  const delegateToLibrarian = tool(
    "delegate_to_librarian",
    "Delegate a wiki task to the Librarian agent. Use for ingesting a source, updating knowledge, answering deep recall questions, or any task that modifies the wiki. Do NOT use for simple lookups — use read_wiki_page / search_wiki directly.",
    {
      task: z
        .string()
        .describe(
          "Plain-language instructions for the Librarian. Include the source content or URL inline when ingesting."
        ),
    },
    async (args) => {
      const out = await runLibrarian({
        task: args.task,
        onProgress: (t) => ctx.onWorkerProgress("librarian", t),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `## Librarian summary\n${out.summary}`,
          },
        ],
      };
    }
  );

  return createSdkMcpServer({
    name: "swarm-delegate",
    version: "0.1.0",
    tools: [delegateToCoder, delegateToReviewer, delegateToLibrarian],
  });
}
