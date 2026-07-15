/** Shared domain types for ClaudeVaultSync. */

/** Summary metadata for a conversation as listed by claude.ai. */
export interface ConversationSummary {
  id: string;
  title: string;
  url: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A single message inside a conversation. */
export interface ConversationMessage {
  id: string;
  sender: "human" | "assistant";
  createdAt: string | null;
  /** Markdown text of the message. */
  text: string;
  attachments: MessageAttachment[];
}

/** An attachment or file referenced by a message. */
export interface MessageAttachment {
  fileName: string;
  /** Text extracted by claude.ai (pasted documents etc.), if any. */
  extractedContent: string | null;
  /** URL path to download the binary, if any. */
  downloadUrl: string | null;
}

/** A fully downloaded conversation. */
export interface FullConversation extends ConversationSummary {
  messages: ConversationMessage[];
}

/** Row stored in the conversations table. */
export interface ConversationRow {
  id: string;
  title: string;
  url: string;
  created_at: string | null;
  updated_at: string | null;
  content_hash: string;
  file_path: string;
  last_synced_at: string;
}

/** Result of one scheduler run. */
export interface SyncRunResult {
  startedAt: string;
  finishedAt: string;
  checked: number;
  downloaded: number;
  updated: number;
  skipped: number;
  errors: number;
  status: "ok" | "login-required" | "failed";
  message?: string;
}

/** Application settings persisted to config/config.json. */
export interface Settings {
  vaultPath: string;
  intervalMinutes: number;
  dashboardPort: number;
  headless: boolean;
}

export type SyncStatus =
  | "idle"
  | "syncing"
  | "paused"
  | "login-required"
  | "error";
