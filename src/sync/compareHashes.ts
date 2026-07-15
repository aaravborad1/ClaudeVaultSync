import { sha256 } from "../utils/hash";
import type { ConversationRow, ConversationSummary } from "../models/types";

/**
 * Cheap pre-check using list metadata: has this conversation possibly changed
 * since the last sync? Used to skip downloads for untouched conversations.
 */
export function possiblyChanged(
  summary: ConversationSummary,
  stored: ConversationRow | undefined
): boolean {
  if (!stored) return true; // brand new
  if (summary.title !== stored.title) return true;
  if (!summary.updatedAt || !stored.updated_at) return true; // no signal — verify by content
  return summary.updatedAt !== stored.updated_at;
}

/** Definitive check: hash of the freshly rendered content vs the stored hash. */
export function contentChanged(
  hashSource: string,
  stored: ConversationRow | undefined
): { changed: boolean; hash: string } {
  const hash = sha256(hashSource);
  return { changed: !stored || stored.content_hash !== hash, hash };
}
