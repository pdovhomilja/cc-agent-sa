import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface SubmitInboxArgs {
  role: string;
  missionId: string | null;
  note: string;
}

export function submitToInbox(wikiRoot: string, args: SubmitInboxArgs): string {
  const inboxDir = path.join(wikiRoot, "inbox");
  fs.mkdirSync(inboxDir, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const suffix = randomBytes(3).toString("hex");
  const filename = `${stamp}-${args.role}-${suffix}.md`;
  const abs = path.join(inboxDir, filename);

  const lines: string[] = ["---", "type: inbox", `submitted_by: ${args.role}`];
  if (args.missionId) lines.push(`mission_id: ${args.missionId}`);
  lines.push(`submitted_at: ${now.toISOString()}`, "---", "", args.note, "");
  fs.writeFileSync(abs, lines.join("\n"), "utf8");

  return `inbox/${filename}`;
}
