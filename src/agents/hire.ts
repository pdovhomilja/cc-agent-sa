#!/usr/bin/env tsx
import fs from "fs";
import path from "path";

// Parse args: pnpm hire <agent-id> --role <path> --department <dept> [--tools <csv>] [--model <model>]
const args = process.argv.slice(2);

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const agentId = args[0];
const rolePath = getFlag("--role");
const department = getFlag("--department");
const toolsArg = getFlag("--tools");
const model = getFlag("--model") ?? "claude-sonnet-4-6";

// Validation
if (!agentId || agentId.startsWith("--")) {
  console.error("Error: <agent-id> is required as the first argument");
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(agentId)) {
  console.error(`Error: agent-id "${agentId}" must match /^[a-z0-9][a-z0-9-]*$/`);
  process.exit(1);
}

if (!rolePath) {
  console.error("Error: --role <path-to-role-md> is required");
  process.exit(1);
}

if (!department) {
  console.error("Error: --department <dept> is required");
  process.exit(1);
}

// Resolve role file
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const resolvedRole = path.resolve(rolePath);

if (!fs.existsSync(resolvedRole)) {
  console.error(`Error: role file not found: ${resolvedRole}`);
  process.exit(1);
}

// Check agent dir doesn't exist
const agentDir = path.join(projectRoot, "agents", agentId);

if (fs.existsSync(agentDir)) {
  console.error(`Error: agent directory already exists: ${agentDir}`);
  process.exit(1);
}

// Parse tools
const nativeTools = toolsArg ? toolsArg.split(",").map((t) => t.trim()) : ["Read", "Glob", "Grep"];

// Create directory structure
fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
fs.mkdirSync(path.join(agentDir, "scratchpad"), { recursive: true });

// Copy role.md
fs.copyFileSync(resolvedRole, path.join(agentDir, "role.md"));

// Generate agent.json
const agentJson = {
  id: agentId,
  department,
  model,
  nativeTools,
  mcpTools: ["fetch_url", "submit_to_librarian"],
  created: new Date().toISOString(),
};
fs.writeFileSync(path.join(agentDir, "agent.json"), JSON.stringify(agentJson, null, 2) + "\n");

// Generate CLAUDE.md
const claudeMd = `# ${agentId} — Agent Workspace

## Role
See [role.md](./role.md) for full role definition.

## Department
${department}

## Procedures

### Starting a task
1. Read role.md to understand your responsibilities
2. Check memory/MEMORY.md for relevant prior context
3. Review the task brief carefully before acting

### During a task
- Work incrementally; verify each step before proceeding
- Record key findings to scratchpad/ as needed
- Surface blockers early rather than guessing

### Completing a task
- Summarize what was done and any open questions
- Update memory/MEMORY.md with durable learnings
- Clean up scratchpad/ if no longer needed
`;
fs.writeFileSync(path.join(agentDir, "CLAUDE.md"), claudeMd);

// Generate memory/MEMORY.md
fs.writeFileSync(path.join(agentDir, "memory", "MEMORY.md"), `# ${agentId} Memory\n\n_No entries yet._\n`);

// Confirmation
console.log(`✓ Agent workspace created: agents/${agentId}/`);
console.log(`  role.md      ← ${resolvedRole}`);
console.log(`  agent.json   (id=${agentId}, dept=${department}, model=${model})`);
console.log(`  CLAUDE.md    (starter template)`);
console.log(`  memory/MEMORY.md`);
console.log(`  scratchpad/`);
