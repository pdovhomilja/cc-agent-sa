import simpleGit, { type SimpleGit } from "simple-git";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

let _repo: SimpleGit | null = null;
function repo(): SimpleGit {
  if (_repo) return _repo;
  if (!fs.existsSync(config.swarm.repoPath)) {
    throw new Error(
      `SWARM_REPO_PATH does not exist: ${config.swarm.repoPath}. Set it in .env to a real git repo.`
    );
  }
  _repo = simpleGit(config.swarm.repoPath);
  return _repo;
}

export async function createWorktree(missionId: string): Promise<{ worktreePath: string; branch: string }> {
  fs.mkdirSync(config.swarm.worktreeRoot, { recursive: true });
  const branch = `swarm/${missionId}`;
  const worktreePath = path.join(config.swarm.worktreeRoot, missionId);
  await repo().raw(["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  return { worktreePath, branch };
}

export async function getDiff(worktreePath: string): Promise<string> {
  const wt = simpleGit(worktreePath);
  const staged = await wt.diff(["--cached"]);
  const unstaged = await wt.diff();
  return [staged, unstaged].filter(Boolean).join("\n");
}

export async function mergeWorktree(missionId: string, branch: string): Promise<void> {
  await repo().raw(["merge", "--no-ff", branch, "-m", `swarm: merge mission ${missionId}`]);
  await removeWorktree(missionId, branch);
}

export async function removeWorktree(missionId: string, branch: string): Promise<void> {
  const worktreePath = path.join(config.swarm.worktreeRoot, missionId);
  try {
    await repo().raw(["worktree", "remove", "--force", worktreePath]);
  } catch {
    // ignore
  }
  try {
    await repo().raw(["branch", "-D", branch]);
  } catch {
    // ignore
  }
}
