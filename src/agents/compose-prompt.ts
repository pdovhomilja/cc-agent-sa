import { KARPATHY_RULES } from "./prompts.js";

export interface ComposeInput {
  roleMd: string;
  sharedSkills: string[];
  claudeMd: string;
}

export function composePrompt(input: ComposeInput): string {
  const sections: string[] = [
    input.roleMd,
    ...input.sharedSkills,
    input.claudeMd,
    KARPATHY_RULES,
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sections.join("\n\n---\n\n");
}
