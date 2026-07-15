import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/filename";

/** Index of conversation notes already present in the vault. */
export interface ExistingIndex {
  byFullId: Map<string, string>;
  byPrefix8: Map<string, string>;
}

/**
 * Owns the Obsidian vault destination. Notes live flat in the vault root,
 * named `YYYY-MM-DD - Title (id8).md` to match the user's existing exports,
 * with binary attachments in Assets/. Writes are atomic (temp file + rename)
 * so an interrupted sync can never leave a half-written note.
 */
export class Vault {
  constructor(
    private root: string,
    private tempDir: string
  ) {}

  ensureBaseDirs(): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.assetsDir(), { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  rootDir(): string {
    return this.root;
  }

  assetsDir(): string {
    return path.join(this.root, "Assets");
  }

  /** Flat note path: <vault>/<YYYY-MM-DD> - <Title> (<id8>).md */
  notePath(title: string, createdAt: string | null, id: string): string {
    const date = createdAt ? new Date(createdAt) : new Date();
    const stamp = Number.isNaN(date.getTime())
      ? new Date().toISOString().slice(0, 10)
      : date.toISOString().slice(0, 10);
    const name = `${stamp} - ${sanitizeFileName(title)} (${id.slice(0, 8)})`;
    return path.join(this.root, `${name}.md`);
  }

  /**
   * Scan existing top-level notes and index them by the conversation id found
   * inside the file (or, failing that, the 8-char id in the filename). This is
   * how the app adopts notes that were exported manually, instead of creating
   * duplicates.
   */
  indexExistingByConversationId(): ExistingIndex {
    const byFullId = new Map<string, string>();
    const byPrefix8 = new Map<string, string>();
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      return { byFullId, byPrefix8 };
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const full = path.join(this.root, entry.name);

      const fnMatch = entry.name.match(/\(([0-9a-fA-F]{8})\)\.md$/);
      if (fnMatch) byPrefix8.set(fnMatch[1]!.toLowerCase(), full);

      try {
        const head = fs.readFileSync(full, "utf8").slice(0, 800);
        const idMatch = head.match(
          /(?:conversation[_ ]?id[:*\s]*)([0-9a-fA-F-]{36})/i
        );
        if (idMatch) byFullId.set(idMatch[1]!.toLowerCase(), full);
      } catch {
        // Unreadable file — skip; filename prefix may still match.
      }
    }
    return { byFullId, byPrefix8 };
  }

  /** Find an existing note for a conversation id, if one is present. */
  findExisting(index: ExistingIndex, conversationId: string): string | null {
    const id = conversationId.toLowerCase();
    return index.byFullId.get(id) ?? index.byPrefix8.get(id.slice(0, 8)) ?? null;
  }

  noteExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Atomically write a note only if its content differs from what's on disk.
   * Returns true if the file was actually written. Avoids rewriting unchanged
   * notes (and preserves the mtime of adopted files that already match).
   */
  writeIfChanged(filePath: string, content: string): boolean {
    if (fs.existsSync(filePath)) {
      try {
        if (fs.readFileSync(filePath, "utf8") === content) return false;
      } catch {
        // Fall through to write.
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = path.join(
      this.tempDir,
      `.note-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
    );
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, filePath);
    return true;
  }

  /** Move a note when its conversation was renamed. */
  renameNote(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    if (!fs.existsSync(oldPath)) return;
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
  }

  /** Save an attachment into Assets/ and return its vault-relative link. */
  writeAsset(conversationId: string, fileName: string, base64: string): string {
    const safe = sanitizeFileName(fileName.replace(/\.[^.]+$/, ""));
    const ext = path.extname(fileName) || "";
    const assetName = `${safe}-${conversationId.slice(0, 8)}${ext}`;
    const assetPath = path.join(this.assetsDir(), assetName);
    if (!fs.existsSync(assetPath)) {
      fs.writeFileSync(assetPath, Buffer.from(base64, "base64"));
    }
    return `Assets/${assetName}`;
  }
}
