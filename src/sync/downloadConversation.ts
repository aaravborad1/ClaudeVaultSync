import type { ClaudeClient } from "../browser/claudeClient";
import type { Vault } from "../obsidian/vault";
import type { ConversationSummary, FullConversation } from "../models/types";
import { getLogger } from "../utils/logger";

export interface DownloadResult {
  conversation: FullConversation;
  /** messageId:fileName → vault-relative asset links. */
  attachmentLinks: Map<string, string[]>;
}

/**
 * Download one conversation in full, saving any downloadable attachments into
 * the vault's Assets/ folder so notes can embed them.
 */
export async function downloadConversation(
  client: ClaudeClient,
  vault: Vault,
  summary: ConversationSummary
): Promise<DownloadResult> {
  const conversation = await client.getConversation(summary);
  const attachmentLinks = new Map<string, string[]>();

  for (const message of conversation.messages) {
    for (const att of message.attachments) {
      if (!att.downloadUrl) continue;
      const base64 = await client.downloadAttachment(att.downloadUrl);
      if (!base64) continue;
      try {
        const link = vault.writeAsset(conversation.id, att.fileName, base64);
        const key = `${message.id}:${att.fileName}`;
        attachmentLinks.set(key, [...(attachmentLinks.get(key) ?? []), link]);
      } catch (err) {
        getLogger().warn(
          { err: String(err), file: att.fileName },
          "Failed to save attachment"
        );
      }
    }
  }
  return { conversation, attachmentLinks };
}
