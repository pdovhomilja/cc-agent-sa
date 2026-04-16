import Database from "better-sqlite3";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

export interface ApprovalRow {
  messageId: string;
  draftId: string;
  platform: "x" | "linkedin";
  createdAt: number;
}

export interface ApprovalStore {
  insert(row: Omit<ApprovalRow, "createdAt">): void;
  get(messageId: string): ApprovalRow | undefined;
  delete(messageId: string): void;
}

export function createApprovalStore(db: BetterSqlite3Database): ApprovalStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approvals (
      message_id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  return {
    insert({ messageId, draftId, platform }) {
      db.prepare(
        "INSERT INTO approvals (message_id, draft_id, platform, created_at) VALUES (?, ?, ?, ?)"
      ).run(messageId, draftId, platform, Date.now());
    },

    get(messageId) {
      const row = db
        .prepare(
          "SELECT message_id, draft_id, platform, created_at FROM approvals WHERE message_id = ?"
        )
        .get(messageId) as
        | { message_id: string; draft_id: string; platform: string; created_at: number }
        | undefined;
      if (!row) return undefined;
      return {
        messageId: row.message_id,
        draftId: row.draft_id,
        platform: row.platform as "x" | "linkedin",
        createdAt: row.created_at,
      };
    },

    delete(messageId) {
      db.prepare("DELETE FROM approvals WHERE message_id = ?").run(messageId);
    },
  };
}

let _store: ApprovalStore | undefined;

/**
 * Lazy singleton accessor. Opens/creates the DB at config.swarm.dbPath on first call.
 *
 * Requires env vars (DISCORD_TOKEN, SWARM_REPO_PATH, etc.) to be set.
 * Do NOT call in tests — use createApprovalStore(new Database(":memory:")) instead.
 *
 * Call initApprovalStore() at application startup to set up the singleton.
 */
export function approvalStore(): ApprovalStore {
  if (!_store) {
    throw new Error(
      "approvalStore(): singleton not initialized. Call initApprovalStore() at startup."
    );
  }
  return _store;
}

/**
 * Initializes the singleton. Await this at application startup before calling approvalStore().
 */
export async function initApprovalStore(): Promise<void> {
  if (_store) return;
  const { config } = await import("../config.js");
  _store = createApprovalStore(new Database(config.swarm.dbPath));
}
