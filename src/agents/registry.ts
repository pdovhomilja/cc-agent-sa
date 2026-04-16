import fs from "fs";
import path from "path";
import { parseAgentConfig, type AgentConfig } from "./agent-config.js";

export interface AgentEntry {
  config: AgentConfig;
  id: string;
  department: string;
  workspacePath: string;
  roleMd: string;
  claudeMd: string;
}

export interface Registry {
  agents: Map<string, AgentEntry>;
  byDepartment(dept: string): AgentEntry | undefined;
}

export function loadRegistry(agentsDir: string): Registry {
  const agents = new Map<string, AgentEntry>();
  const departmentMap = new Map<string, AgentEntry>();

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const workspacePath = path.join(agentsDir, entry.name);
    const configPath = path.join(workspacePath, "agent.json");

    if (!fs.existsSync(configPath)) continue;

    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const config = parseAgentConfig(raw);

    const roleMd = fs.readFileSync(path.join(workspacePath, "role.md"), "utf8");
    const claudeMd = fs.readFileSync(path.join(workspacePath, "CLAUDE.md"), "utf8");

    const agentEntry: AgentEntry = {
      config,
      id: config.id,
      department: config.department,
      workspacePath,
      roleMd,
      claudeMd,
    };

    agents.set(config.id, agentEntry);

    if (!departmentMap.has(config.department)) {
      departmentMap.set(config.department, agentEntry);
    }
  }

  return {
    agents,
    byDepartment(dept: string): AgentEntry | undefined {
      return departmentMap.get(dept);
    },
  };
}
