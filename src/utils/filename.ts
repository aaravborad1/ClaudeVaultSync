/** Turn a conversation title into a safe Markdown filename (without extension). */
export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[\/\\:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned : "Untitled Conversation";
}
