import { describe, it, expect } from "vitest";
import { parseAgentConfig } from "../src/agents/agent-config.js";

describe("parseAgentConfig", () => {
  const valid = {
    id: "agent-001",
    department: "engineering",
    model: "claude-sonnet-4-5",
    nativeTools: ["Read", "Write", "Bash"],
    mcpTools: ["github"],
    created: "2026-04-15T00:00:00Z",
  };

  it("parses a valid config", () => {
    const config = parseAgentConfig(valid);
    expect(config.id).toBe("agent-001");
    expect(config.department).toBe("engineering");
    expect(config.model).toBe("claude-sonnet-4-5");
    expect(config.nativeTools).toEqual(["Read", "Write", "Bash"]);
    expect(config.mcpTools).toEqual(["github"]);
    expect(config.created).toBe("2026-04-15T00:00:00Z");
  });

  it("rejects config missing id", () => {
    const { id: _id, ...noId } = valid;
    expect(() => parseAgentConfig(noId)).toThrow(/id/);
  });

  it("rejects config with unknown native tool", () => {
    expect(() =>
      parseAgentConfig({ ...valid, nativeTools: ["Read", "UnknownTool"] })
    ).toThrow(/UnknownTool/);
  });
});
