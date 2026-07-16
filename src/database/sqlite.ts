import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type {
  ConversationRow,
  ConversationMessage,
  SyncRunResult,
} from "../models/types";

/**
 * Local SQLite store tracking every synced conversation, its messages, and
 * the history of sync runs. This is what prevents duplicate notes and
 * unnecessary rewrites. Uses Bun's built-in SQLite driver (same synchronous
 * API family as better-sqlite3).
 */
export class SyncDatabase {
  private db: Database;

  constructor(databaseDir: string) {
    fs.mkdirSync(databaseDir, { recursive: true });
    this.db = new Database(path.join(databaseDir, "claudevaultsync.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        url            TEXT NOT NULL,
        created_at     TEXT,
        updated_at     TEXT,
        content_hash   TEXT NOT NULL,
        file_path      TEXT NOT NULL,
        last_synced_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        position        INTEGER NOT NULL,
        sender          TEXT NOT NULL,
        created_at      TEXT,
        text_hash       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at  TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        checked     INTEGER NOT NULL,
        downloaded  INTEGER NOT NULL,
        updated     INTEGER NOT NULL,
        skipped     INTEGER NOT NULL,
        errors      INTEGER NOT NULL,
        status      TEXT NOT NULL,
        message     TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id);
    `);
  }

  getConversation(id: string): ConversationRow | undefined {
    const row = this.db
      .query("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | null;
    return row ?? undefined;
  }

  countConversations(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM conversations")
      .get() as { n: number };
    return row.n;
  }

  /** Upsert a conversation and replace its message index, atomically. */
  saveConversation(
    row: ConversationRow,
    messages: ConversationMessage[],
    textHashes: string[]
  ): void {
    const tx = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO conversations
             (id, title, url, created_at, updated_at, content_hash, file_path, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, url = excluded.url,
             created_at = excluded.created_at, updated_at = excluded.updated_at,
             content_hash = excluded.content_hash, file_path = excluded.file_path,
             last_synced_at = excluded.last_synced_at`
        )
        .run(
          row.id,
          row.title,
          row.url,
          row.created_at,
          row.updated_at,
          row.content_hash,
          row.file_path,
          row.last_synced_at
        );

      this.db.query("DELETE FROM messages WHERE conversation_id = ?").run(row.id);
      const insert = this.db.query(
        `INSERT INTO messages (id, conversation_id, position, sender, created_at, text_hash)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      messages.forEach((m, i) => {
        insert.run(m.id, row.id, i, m.sender, m.createdAt, textHashes[i] ?? "");
      });
    });
    tx();
  }

  recordSyncRun(result: SyncRunResult): void {
    this.db
      .query(
        `INSERT INTO sync_history
           (started_at, finished_at, checked, downloaded, updated, skipped, errors, status, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        result.startedAt,
        result.finishedAt,
        result.checked,
        result.downloaded,
        result.updated,
        result.skipped,
        result.errors,
        result.status,
        result.message ?? null
      );
  }

  lastSyncRun(): SyncRunResult | undefined {
    const row = this.db
      .query("SELECT * FROM sync_history ORDER BY id DESC LIMIT 1")
      .get() as
      | {
          started_at: string;
          finished_at: string;
          checked: number;
          downloaded: number;
          updated: number;
          skipped: number;
          errors: number;
          status: string;
          message: string | null;
        }
      | null;
    if (!row) return undefined;
    return {
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      checked: row.checked,
      downloaded: row.downloaded,
      updated: row.updated,
      skipped: row.skipped,
      errors: row.errors,
      status: row.status as SyncRunResult["status"],
      message: row.message ?? undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
