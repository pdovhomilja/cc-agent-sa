import fs from "node:fs";
import path from "node:path";
import { getMission } from "./store.js";
import { getDiff } from "./worktree.js";
import { runLibrarian } from "../agents/librarian.js";
import { config } from "../config.js";

export interface CaptureTaskInput {
  missionId: string;
  brief: string;
  diff: string;
}

const MAX_DIFF_CHARS = 8000;

export function buildCaptureTask(input: CaptureTaskInput): string {
  const diff =
    input.diff.length > MAX_DIFF_CHARS
      ? input.diff.slice(0, MAX_DIFF_CHARS) + "\n... (truncated)"
      : input.diff;

  return [
    `A swarm mission just completed. File it into the wiki following CLAUDE.md.`,
    ``,
    `## Mission`,
    `- id: ${input.missionId}`,
    `- verdict: APPROVE`,
    `- brief: ${input.brief}`,
    ``,
    `## Diff`,
    "```diff",
    diff,
    "```",
    ``,
    `## Instructions`,
    `1. Create or extend \`missions/${input.missionId}.md\` with a summary of what changed, the verdict, and any notable findings from the diff.`,
    `2. Update any affected entity, concept, or project pages that the diff touches (e.g. new API endpoints, changed conventions).`,
    `3. Append a log line for every write.`,
    `4. Process any pending items in \`inbox/\` if they relate to this mission.`,
    `5. Commit once with an appropriate message.`,
  ].join("\n");
}

export function captureMissionInBackground(missionId: string): void {
  // Fire-and-forget. Runs after the function returns. Never throws to the caller.
  void (async () => {
    try {
      const mission = getMission(missionId);
      if (!mission) return;
      const diff = await getDiff(mission.worktreePath);
      const task = buildCaptureTask({
        missionId: mission.id,
        brief: mission.brief,
        diff,
      });
      await runLibrarian({ task });
    } catch (err) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const errDir = path.join(config.swarm.wikiPath, "inbox", "_errors");
      const errMsg = err instanceof Error ? err.message : String(err);
      const likelyConcurrent = /lock|index|working tree|conflict/i.test(errMsg);
      try {
        fs.mkdirSync(errDir, { recursive: true });
        fs.writeFileSync(
          path.join(errDir, `${stamp}-capture-${missionId}.md`),
          `# Capture failed\n\nmission: ${missionId}\n${
            likelyConcurrent ? "likely cause: concurrent capture / git collision\n" : ""
          }error: ${errMsg}\n`,
          "utf8"
        );
      } catch (innerErr) {
        console.error(`[capture] failed to log error for ${missionId}:`, innerErr);
      }
      console.error(
        `[capture] mission ${missionId}:`,
        err instanceof Error ? err.message : err
      );
    }
  })();
}
