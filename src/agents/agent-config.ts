const NATIVE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"] as const;

export type NativeTool = (typeof NATIVE_TOOLS)[number];

export interface AgentConfig {
  id: string;
  department: string;
  model: string;
  nativeTools: NativeTool[];
  mcpTools: string[];
  created: string;
}

export function parseAgentConfig(raw: unknown): AgentConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("config must be an object");
  }
  const r = raw as Record<string, unknown>;

  if (typeof r["id"] !== "string" || r["id"].trim() === "") {
    throw new Error("config missing required field: id");
  }
  if (typeof r["department"] !== "string") {
    throw new Error("config missing required field: department");
  }
  if (typeof r["model"] !== "string") {
    throw new Error("config missing required field: model");
  }
  if (!Array.isArray(r["nativeTools"])) {
    throw new Error("config missing required field: nativeTools");
  }
  for (const tool of r["nativeTools"]) {
    if (!(NATIVE_TOOLS as readonly string[]).includes(tool)) {
      throw new Error(`unknown native tool: ${tool}`);
    }
  }
  if (!Array.isArray(r["mcpTools"])) {
    throw new Error("config missing required field: mcpTools");
  }
  if (typeof r["created"] !== "string") {
    throw new Error("config missing required field: created");
  }

  return {
    id: r["id"],
    department: r["department"],
    model: r["model"],
    nativeTools: r["nativeTools"] as NativeTool[],
    mcpTools: r["mcpTools"] as string[],
    created: r["created"],
  };
}
