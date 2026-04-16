import { describe, it, expect } from "vitest";
import { composePrompt } from "../src/agents/compose-prompt.js";
import { KARPATHY_RULES } from "../src/agents/prompts.js";

const SEPARATOR = "\n\n---\n\n";

describe("composePrompt", () => {
  it("joins role → shared skills → claudeMd → karpathy rules in correct order, separated by ---", () => {
    const result = composePrompt({
      roleMd: "## Role\nI am the Coder.",
      sharedSkills: ["## Wiki Conventions\nUse YAML front-matter.", "## Git Rules\nSmall commits."],
      claudeMd: "## Agent CLAUDE.md\nSwarm-specific procedures.",
    });

    const parts = result.split(SEPARATOR);
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("## Role\nI am the Coder.");
    expect(parts[1]).toBe("## Wiki Conventions\nUse YAML front-matter.");
    expect(parts[2]).toBe("## Git Rules\nSmall commits.");
    expect(parts[3]).toBe("## Agent CLAUDE.md\nSwarm-specific procedures.");
    expect(parts[4]).toBe(KARPATHY_RULES);

    // Verify overall order
    const roleIdx = result.indexOf("## Role");
    const wikiIdx = result.indexOf("## Wiki Conventions");
    const gitIdx = result.indexOf("## Git Rules");
    const claudeIdx = result.indexOf("## Agent CLAUDE.md");
    const karpathyIdx = result.indexOf("## Coding Rules");
    expect(roleIdx).toBeLessThan(wikiIdx);
    expect(wikiIdx).toBeLessThan(gitIdx);
    expect(gitIdx).toBeLessThan(claudeIdx);
    expect(claudeIdx).toBeLessThan(karpathyIdx);
  });

  it("omits empty claudeMd section", () => {
    const result = composePrompt({
      roleMd: "## Role\nI am the Reviewer.",
      sharedSkills: ["## Skill\nSome skill."],
      claudeMd: "",
    });

    expect(result).not.toContain(SEPARATOR + SEPARATOR);
    const parts = result.split(SEPARATOR);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("## Role\nI am the Reviewer.");
    expect(parts[1]).toBe("## Skill\nSome skill.");
    expect(parts[2]).toBe(KARPATHY_RULES);
  });

  it("omits empty sharedSkills array", () => {
    const result = composePrompt({
      roleMd: "## Role\nCEO.",
      sharedSkills: [],
      claudeMd: "## Agent Procedures\nDo things.",
    });

    const parts = result.split(SEPARATOR);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("## Role\nCEO.");
    expect(parts[1]).toBe("## Agent Procedures\nDo things.");
    expect(parts[2]).toBe(KARPATHY_RULES);
  });

  it("omits whitespace-only sections", () => {
    const result = composePrompt({
      roleMd: "## Role\nLibrarian.",
      sharedSkills: ["   ", "## Real Skill\nContent."],
      claudeMd: "  \n  ",
    });

    const parts = result.split(SEPARATOR);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("## Role\nLibrarian.");
    expect(parts[1]).toBe("## Real Skill\nContent.");
    expect(parts[2]).toBe(KARPATHY_RULES);
  });
});
