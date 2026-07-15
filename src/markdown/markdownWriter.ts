import type { FullConversation } from "../models/types";

export interface RenderedNote {
  /** Full note text. */
  content: string;
  /** Stable text used for change detection. */
  hashSource: string;
}

/**
 * Render a conversation as an Obsidian-ready Markdown note. The format matches
 * the user's existing manual Cowork exports exactly: an H1 title, bold
 * metadata lines, a horizontal rule, then `## Human` / `## Claude` sections.
 * Message text is written verbatim so code fences, tables, math and every
 * other Markdown construct survive untouched.
 */
export function renderNote(
  conversation: FullConversation,
  attachmentLinks: Map<string, string[]>
): RenderedNote {
  const header: string[] = [`# ${conversation.title}`, ""];
  header.push(`**Conversation ID:** ${conversation.id}`);
  if (conversation.createdAt) header.push(`**Created:** ${conversation.createdAt}`);
  if (conversation.updatedAt) {
    header.push(`**Last updated:** ${conversation.updatedAt}`);
  }

  const blocks: string[] = [header.join("\n"), "---"];

  for (const message of conversation.messages) {
    const role = message.sender === "human" ? "## Human" : "## Claude";
    const parts: string[] = [role];
    if (message.text) parts.push(message.text);

    for (const att of message.attachments) {
      const links = attachmentLinks.get(`${message.id}:${att.fileName}`);
      if (links && links.length > 0) {
        for (const link of links) parts.push(`![[${link}]]`);
      } else if (att.extractedContent) {
        parts.push(
          `> [!quote]- Attachment: ${att.fileName}\n` +
            att.extractedContent
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n")
        );
      } else {
        parts.push(`*Attachment: ${att.fileName}*`);
      }
    }
    blocks.push(parts.join("\n\n"));
  }

  const content = blocks.join("\n\n") + "\n";
  return { content, hashSource: content };
}
