import type { ClaudeClient } from "../browser/claudeClient";
import type { ConversationSummary } from "../models/types";

/**
 * Discover every conversation visible to the account. Thin façade over the
 * client so the sync engine doesn't depend on transport details.
 */
export async function discoverConversations(
  client: ClaudeClient
): Promise<ConversationSummary[]> {
  return client.listConversations();
}
