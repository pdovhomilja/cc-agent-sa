import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

export type MissionStatus = "open" | "coding" | "reviewing" | "awaiting_approval" | "merged" | "discarded" | "failed";

export interface Mission {
  id: string;
  threadId: string;
  brief: string;
  status: MissionStatus;
  worktreePath: string;
  branch: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSession {
  missionId: string;
  role: string;
  sessionId: string;
  updatedAt: number;
}

fs.mkdirSync(path.dirname(config.swarm.dbPath), { recursive: true });
const db = new Database(config.swarm.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    brief TEXT NOT NULL,
    status TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_sessions (
    mission_id TEXT NOT NULL,
    role TEXT NOT NULL,
    session_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (mission_id, role)
  );
`);

export function createMission(m: Omit<Mission, "createdAt" | "updatedAt">): Mission {
  const now = Date.now();
  db.prepare(
    `INSERT INTO missions (id, thread_id, brief, status, worktree_path, branch, created_at, updated_at)
     VALUES (@id, @threadId, @brief, @status, @worktreePath, @branch, @createdAt, @updatedAt)`
  ).run({ ...m, createdAt: now, updatedAt: now });
  return { ...m, createdAt: now, updatedAt: now };
}

export function getMission(id: string): Mission | undefined {
  const row = db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    threadId: row.thread_id,
    brief: row.brief,
    status: row.status,
    worktreePath: row.worktree_path,
    branch: row.branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getMissionByThread(threadId: string): Mission | undefined {
  const row = db.prepare(`SELECT * FROM missions WHERE thread_id = ?`).get(threadId) as any;
  if (!row) return undefined;
  return getMission(row.id);
}

export function updateMissionStatus(id: string, status: MissionStatus): void {
  db.prepare(`UPDATE missions SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), id);
}

export function saveSession(s: Omit<AgentSession, "updatedAt">): void {
  db.prepare(
    `INSERT INTO agent_sessions (mission_id, role, session_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(mission_id, role) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
  ).run(s.missionId, s.role, s.sessionId, Date.now());
}

export function getSession(missionId: string, role: string): string | undefined {
  const row = db.prepare(`SELECT session_id FROM agent_sessions WHERE mission_id = ? AND role = ?`).get(missionId, role) as any;
  return row?.session_id;
}
