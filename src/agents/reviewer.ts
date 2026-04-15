import { query } from "@anthropic-ai/claude-agent-sdk";
import { REVIEWER_SYSTEM_PROMPT } from "./prompts.js";
import { getSession, saveSession } from "../missions/store.js";

export interface ReviewerInput {
  missionId: string;
  worktreePath: string;
  brief: string;
  diff: string;
  onProgress?: (text: string) => void;
}

export interface ReviewerOutput {
  verdict: "APPROVE" | "REJECT";
  notes: string;
  sessionId: string;
}

export async function runReviewer(input: ReviewerInput): Promise<ReviewerOutput> {
  const resume = getSession(input.missionId, "reviewer");

  const prompt = `
# Mission brief
${input.brief}

# Diff to review
\`\`\`diff
${input.diff}
\`\`\`

Review the diff against the mission brief. Begin your final response with exactly one of:
\`VERDICT: APPROVE\` or \`VERDICT: REJECT\`
Then list your reasoning with file:line references.
`.trim();

  const result = query({
    prompt,
    options: {
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      cwd: input.worktreePath,
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      permissionMode: "default",
      resume,
    },
  });

  let text = "";
  let sessionId = resume ?? "";

  for await (const msg of result) {
    if (msg.type === "system" && msg.subtype === "init") sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          text += block.text;
          input.onProgress?.(block.text);
        }
      }
    }
    if (msg.type === "result") {
      if (msg.subtype === "success") text = msg.result;
      sessionId = msg.session_id;
    }
  }

  saveSession({ missionId: input.missionId, role: "reviewer", sessionId });

  const verdict: "APPROVE" | "REJECT" = /VERDICT:\s*APPROVE/i.test(text) ? "APPROVE" : "REJECT";
  return { verdict, notes: text, sessionId };
}
