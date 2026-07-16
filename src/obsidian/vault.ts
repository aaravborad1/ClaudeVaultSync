import fs from "node:fs";
import path from "node:path";
import { sanitizeFileName } from "../utils/filename";

const NAMED_DIR = "Named Claude Chats";
const UNTITLED_DIR = "Untitled Claude Chats";
const ASSETS_DIR = "Assets";
/** Must match the literal fallback title assigned in claudeClient.ts. */
const UNTITLED_TITLE = "untitled conversation";

/** Index of conversation notes already present in the vault, at any depth. */
export interface ExistingIndex {
  byFullId: Map<string, string>;
  byPrefix8: Map<string, string>;
}

/**
 * Owns the Obsidian vault destination. Existing notes are searched for
 * recursively (the user may file them into any subfolder — e.g. "Named
 * Claude Chats" / "Untitled Claude Chats") and are always updated in place,
 * never relocated. Only conversations with no existing note anywhere in the
 * vault get a fresh path, sorted into Named/Untitled by title. Attachments
 * live flatly in Assets/ and are embedded by bare filename (no folder
 * prefix) so links keep resolving no matter how deeply a note is filed.
 * Writes are atomic (temp file + rename) so an interrupted sync can never
 * leave a half-written note.
 */
export class Vault {
  constructor(
    private root: string,
    private tempDir: string
  ) {}

  ensureBaseDirs(): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(this.assetsDir(), { recursive: true });
    fs.mkdirSync(path.join(this.root, NAMED_DIR), { recursive: true });
    fs.mkdirSync(path.join(this.root, UNTITLED_DIR), { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  rootDir(): string {
    return this.root;
  }

  assetsDir(): string {
    return path.join(this.root, ASSETS_DIR);
  }

  /** Bare filename (no directory) for a conversation note. */
  noteFileName(title: string, createdAt: string | null, id: string): string {
    const date = createdAt ? new Date(createdAt) : new Date();
    const stamp = Number.isNaN(date.getTime())
      ? new Date().toISOString().slice(0, 10)
      : date.toISOString().slice(0, 10);
    return `${stamp} - ${sanitizeFileName(title)} (${id.slice(0, 8)}).md`;
  }

  /** Which subfolder a brand-new conversation should be filed into. */
  private subfolderFor(title: string): string {
    const isUntitled = title.trim().toLowerCase() === UNTITLED_TITLE;
    return path.join(this.root, isUntitled ? UNTITLED_DIR : NAMED_DIR);
  }

  /** Full path for a brand-new conversation with no existing note. */
  notePathForNew(title: string, createdAt: string | null, id: string): string {
    return path.join(this.subfolderFor(title), this.noteFileName(title, createdAt, id));
  }

  /**
   * Recursively scan every .md file under the vault root and index it by the
   * conversation id found inside the file (or, failing that, the 8-char id in
   * the filename). This is how the app finds and updates notes in place no
   * matter which subfolder the user has filed them into, instead of creating
   * duplicates.
   */
  indexExistingByConversationId(): ExistingIndex {
    const byFullId = new Map<string, string>();
    const byPrefix8 = new Map<string, string>();

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === this.assetsDir()) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

        const fnMatch = entry.name.match(/\(([0-9a-fA-F]{8})\)\.md$/);
        if (fnMatch) byPrefix8.set(fnMatch[1]!.toLowerCase(), full);

        try {
          const head = fs.readFileSync(full, "utf8").slice(0, 800);
          const idMatch = head.match(
            /(?:conversation[_ ]?id[:*\s]*)([0-9a-fA-F-]{36})/i
          );
          if (idMatch) byFullId.set(idMatch[1]!.toLowerCase(), full);
        } catch {
          // Unreadable file — filename prefix match (if any) still stands.
        }
      }
    };
    walk(this.root);

    return { byFullId, byPrefix8 };
  }

  /** Find an existing note for a conversation id, if one is present. */
  findExisting(index: ExistingIndex, conversationId: string): string | null {
    const id = conversationId.toLowerCase();
    return index.byFullId.get(id) ?? index.byPrefix8.get(id.slice(0, 8)) ?? null;
  }

  /**
   * Atomically write a note only if its content differs from what's on disk.
   * Returns true if the file was actually written.
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

  /** Move/rename a note (e.g. its title changed). Same folder unless told otherwise. */
  renameNote(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    if (!fs.existsSync(oldPath)) return;
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
  }

  /**
   * Save an attachment into Assets/ and return its bare filename (no folder
   * prefix) for use in a `![[filename]]` embed — that form keeps resolving
   * regardless of how deeply the note itself ends up filed.
   */
  writeAsset(conversationId: string, fileName: string, base64: string): string {
    const safe = sanitizeFileName(fileName.replace(/\.[^.]+$/, ""));
    const ext = path.extname(fileName) || "";
    const assetName = `${safe}-${conversationId.slice(0, 8)}${ext}`;
    const assetPath = path.join(this.assetsDir(), assetName);
    if (!fs.existsSync(assetPath)) {
      fs.writeFileSync(assetPath, Buffer.from(base64, "base64"));
    }
    return assetName;
  }
}
