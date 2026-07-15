import type { ClaudeClient } from "../browser/claudeClient";
import { NotLoggedInError } from "../browser/claudeClient";
import type { SyncDatabase } from "../database/sqlite";
import type { Vault } from "../obsidian/vault";
import type { ConversationSummary, SyncRunResult } from "../models/types";
import { renderNote } from "../markdown/markdownWriter";
import { possiblyChanged, contentChanged } from "./compareHashes";
import { downloadConversation } from "./downloadConversation";
import { sha256 } from "../utils/hash";
import { sleep } from "../utils/retry";
import { getLogger } from "../utils/logger";

/**
 * The heart of ClaudeVaultSync. One run:
 *   discover → diff against SQLite → download only new/changed → render
 *   Markdown → write into the vault → record history.
 *
 * Unchanged conversations are skipped without touching their files, so a run
 * over thousands of conversations that changed nothing writes nothing.
 */
export class SyncEngine {
  private running = false;

  constructor(
    private client: ClaudeClient,
    private db: SyncDatabase,
    private vault: Vault
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async run(): Promise<SyncRunResult> {
    const log = getLogger();
    const startedAt = new Date().toISOString();
    let checked = 0;
    let downloaded = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    if (this.running) {
      return this.finish(startedAt, 0, 0, 0, 0, 0, "ok", "Sync already running");
    }
    this.running = true;

    try {
      const summaries = await this.client.listConversations();
      checked = summaries.length;
      // Index notes already in the vault so we adopt (and update in place)
      // manually-exported files instead of creating duplicates.
      const existing = this.vault.indexExistingByConversationId();
      log.info(
        { checked, existingNotes: existing.byFullId.size },
        "Discovered conversations"
      );

      for (const summary of summaries) {
        try {
          const stored = this.db.getConversation(summary.id);
          if (!possiblyChanged(summary, stored)) {
            skipped++;
            continue;
          }

          const isNew = !stored;
          const { conversation, attachmentLinks } = await downloadConversation(
            this.client,
            this.vault,
            summary
          );
          const note = renderNote(conversation, attachmentLinks);
          const { hash } = contentChanged(note.hashSource, stored);

          // Decide the note's path.
          let filePath: string;
          if (stored) {
            // Rename detection: title changed → the note moves with it.
            const desiredPath = this.resolveNotePath(conversation);
            if (stored.file_path !== desiredPath) {
              this.vault.renameNote(stored.file_path, desiredPath);
              log.info(
                { from: stored.file_path, to: desiredPath },
                "Conversation renamed"
              );
            }
            filePath = desiredPath;
          } else {
            // New to us: adopt an existing note for this conversation if one
            // is already in the vault, otherwise pick a fresh path.
            filePath =
              this.vault.findExisting(existing, conversation.id) ??
              this.resolveNotePath(conversation);
          }

          const wrote = this.vault.writeIfChanged(filePath, note.content);
          if (!wrote) {
            skipped++;
            // Still record it so future runs track this conversation.
          }
          this.db.saveConversation(
            {
              id: conversation.id,
              title: conversation.title,
              url: conversation.url,
              created_at: conversation.createdAt,
              updated_at: conversation.updatedAt,
              content_hash: hash,
              file_path: filePath,
              last_synced_at: new Date().toISOString(),
            },
            conversation.messages,
            conversation.messages.map((m) => sha256(m.text))
          );

          if (wrote) {
            if (isNew) downloaded++;
            else updated++;
          }
          await sleep(300); // be gentle with the service
        } catch (err) {
          if (err instanceof NotLoggedInError) throw err;
          errors++;
          log.error(
            { err: String(err), conversation: summary.id, title: summary.title },
            "Failed to sync conversation"
          );
        }
      }

      return this.finish(startedAt, checked, downloaded, updated, skipped, errors, "ok");
    } catch (err) {
      if (err instanceof NotLoggedInError) {
        log.warn("Session expired — login required");
        return this.finish(
          startedAt, checked, downloaded, updated, skipped, errors,
          "login-required", "Claude session expired; please log in again"
        );
      }
      log.error({ err: String(err) }, "Sync run failed");
      return this.finish(
        startedAt, checked, downloaded, updated, skipped, errors,
        "failed", String(err)
      );
    } finally {
      this.running = false;
    }
  }

  /** Pick a note path for a conversation. */
  private resolveNotePath(conversation: {
    id: string;
    title: string;
    createdAt: string | null;
  }): string {
    return this.vault.notePath(
      conversation.title,
      conversation.createdAt,
      conversation.id
    );
  }

  private finish(
    startedAt: string,
    checked: number,
    downloaded: number,
    updated: number,
    skipped: number,
    errors: number,
    status: SyncRunResult["status"],
    message?: string
  ): SyncRunResult {
    const result: SyncRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checked, downloaded, updated, skipped, errors,
      status, message,
    };
    try {
      this.db.recordSyncRun(result);
    } catch (err) {
      getLogger().error({ err: String(err) }, "Failed to record sync history");
    }
    getLogger().info(
      {
        checked: result.checked,
        downloaded: result.downloaded,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        status: result.status,
      },
      "Sync run finished"
    );
    return result;
  }
}
