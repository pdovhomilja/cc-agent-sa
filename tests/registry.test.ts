import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadRegistry } from "../src/agents/registry.js";

function makeTmpAgentsDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-test-"));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const agentA = {
  id: "agent-alpha",
  department: "engineering",
  model: "claude-sonnet-4-5",
  nativeTools: ["Read", "Write"],
  mcpTools: ["github"],
  created: "2026-04-15T00:00:00Z",
};

const agentB = {
  id: "agent-beta",
  department: "design",
  model: "claude-sonnet-4-5",
  nativeTools: ["Read"],
  mcpTools: [],
  created: "2026-04-15T00:00:00Z",
};

function writeAgent(
  agentsDir: string,
  config: typeof agentA | typeof agentB,
  roleMd: string,
  claudeMd: string
) {
  const agentDir = path.join(agentsDir, config.id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "agent.json"),
    JSON.stringify(config),
    "utf8"
  );
  fs.writeFileSync(path.join(agentDir, "role.md"), roleMd, "utf8");
  fs.writeFileSync(path.join(agentDir, "CLAUDE.md"), claudeMd, "utf8");
}

describe("loadRegistry", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  it("loads all agents and builds department map", () => {
    const { dir, cleanup: c } = makeTmpAgentsDir();
    cleanup = c;

    writeAgent(dir, agentA, "Role Alpha", "Claude Alpha");
    writeAgent(dir, agentB, "Role Beta", "Claude Beta");

    const registry = loadRegistry(dir);

    expect(registry.agents.size).toBe(2);
    expect(registry.agents.has("agent-alpha")).toBe(true);
    expect(registry.agents.has("agent-beta")).toBe(true);

    const alpha = registry.byDepartment("engineering");
    expect(alpha).toBeDefined();
    expect(alpha!.id).toBe("agent-alpha");

    const beta = registry.byDepartment("design");
    expect(beta).toBeDefined();
    expect(beta!.id).toBe("agent-beta");

    expect(registry.byDepartment("unknown-dept")).toBeUndefined();
  });

  it("reads role.md and CLAUDE.md into agent entry", () => {
    const { dir, cleanup: c } = makeTmpAgentsDir();
    cleanup = c;

    writeAgent(dir, agentA, "# Alpha Role", "# Alpha Claude Instructions");

    const registry = loadRegistry(dir);
    const entry = registry.agents.get("agent-alpha");

    expect(entry).toBeDefined();
    expect(entry!.roleMd).toBe("# Alpha Role");
    expect(entry!.claudeMd).toBe("# Alpha Claude Instructions");
    expect(entry!.config.department).toBe("engineering");
    expect(entry!.workspacePath).toBe(path.join(dir, "agent-alpha"));
  });
});
