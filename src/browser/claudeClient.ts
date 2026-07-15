import type { Page } from "playwright";
import type {
  ConversationSummary,
  ConversationMessage,
  FullConversation,
  MessageAttachment,
} from "../models/types";
import type { BrowserManager } from "./browser";
import { retry, sleep } from "../utils/retry";
import { getLogger } from "../utils/logger";

const BASE = "https://claude.ai";
const PAGE_SIZE = 50;

/** Error thrown when the session is no longer authenticated. */
export class NotLoggedInError extends Error {
  constructor() {
    super("Claude session is not authenticated");
  }
}

/**
 * Reads the user's own conversations through their authenticated browser
 * session, using the same JSON endpoints the claude.ai web app itself calls.
 * All requests run inside the page (same-origin fetch with session cookies) —
 * nothing here bypasses authentication or access controls.
 */
export class ClaudeClient {
  private orgId: string | null = null;

  constructor(private browser: BrowserManager) {}

  private async fetchJson<T>(path: string): Promise<T> {
    const page = await this.ensureOnClaude();
    return retry(async () => {
      const result = await page.evaluate(async (url: string) => {
        const res = await fetch(url, {
          headers: { accept: "application/json" },
        });
        return { status: res.status, body: await res.text() };
      }, `${BASE}${path}`);

      if (result.status === 401 || result.status === 403) {
        throw new NotLoggedInError();
      }
      if (result.status !== 200) {
        throw new Error(`GET ${path} failed with status ${result.status}`);
      }
      return JSON.parse(result.body) as T;
    }, 3, 1500);
  }

  private async fetchBinaryBase64(path: string): Promise<string | null> {
    const page = await this.ensureOnClaude();
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const result = await page.evaluate(async (u: string) => {
      const res = await fetch(u);
      if (res.status !== 200) return null;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    }, url);
    return result;
  }

  private async ensureOnClaude(): Promise<Page> {
    const page = await this.browser.getPage();
    if (!page.url().startsWith(BASE)) {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    return page;
  }

  /** True when the saved session is authenticated. */
  async isLoggedIn(): Promise<boolean> {
    try {
      await this.getOrgId();
      return true;
    } catch (err) {
      if (err instanceof NotLoggedInError) return false;
      throw err;
    }
  }

  private async getOrgId(): Promise<string> {
    if (this.orgId) return this.orgId;
    const orgs = await this.fetchJson<
      Array<{ uuid: string; capabilities?: string[] }>
    >("/api/organizations");
    if (!Array.isArray(orgs) || orgs.length === 0) throw new NotLoggedInError();
    const chatOrg =
      orgs.find((o) => (o.capabilities ?? []).includes("chat")) ?? orgs[0]!;
    this.orgId = chatOrg.uuid;
    return this.orgId;
  }

  /** Reset cached state (used after re-login or browser relaunch). */
  reset(): void {
    this.orgId = null;
  }

  /** List every conversation visible to the account, newest first. */
  async listConversations(): Promise<ConversationSummary[]> {
    const orgId = await this.getOrgId();
    const all: ConversationSummary[] = [];
    const seen = new Set<string>();

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const batch = await this.fetchJson<
        Array<{
          uuid: string;
          name: string | null;
          created_at?: string;
          updated_at?: string;
        }>
      >(
        `/api/organizations/${orgId}/chat_conversations?limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (!Array.isArray(batch) || batch.length === 0) break;

      let newCount = 0;
      for (const c of batch) {
        if (seen.has(c.uuid)) continue;
        seen.add(c.uuid);
        newCount++;
        all.push({
          id: c.uuid,
          title: c.name?.trim() || "Untitled Conversation",
          url: `${BASE}/chat/${c.uuid}`,
          createdAt: c.created_at ?? null,
          updatedAt: c.updated_at ?? null,
        });
      }
      // Endpoint ignored pagination (returned everything) or last page reached.
      if (newCount === 0 || batch.length < PAGE_SIZE) break;
      await sleep(250);
    }
    return all;
  }

  /** Download the full content of one conversation. */
  async getConversation(summary: ConversationSummary): Promise<FullConversation> {
    const orgId = await this.getOrgId();
    const data = await this.fetchJson<{
      uuid: string;
      name: string | null;
      created_at?: string;
      updated_at?: string;
      chat_messages?: RawMessage[];
    }>(
      `/api/organizations/${orgId}/chat_conversations/${summary.id}?tree=True&rendering_mode=messages&render_all_tools=true`
    );

    const messages = (data.chat_messages ?? []).map(parseMessage);
    return {
      ...summary,
      title: data.name?.trim() || summary.title,
      createdAt: data.created_at ?? summary.createdAt,
      updatedAt: data.updated_at ?? summary.updatedAt,
      messages,
    };
  }

  /** Best-effort download of an attachment binary as base64. */
  async downloadAttachment(downloadUrl: string): Promise<string | null> {
    try {
      return await this.fetchBinaryBase64(downloadUrl);
    } catch (err) {
      getLogger().warn({ err: String(err) }, "Attachment download failed");
      return null;
    }
  }
}

interface RawContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

interface RawMessage {
  uuid: string;
  sender: string;
  created_at?: string;
  text?: string;
  content?: RawContentBlock[];
  attachments?: Array<{
    file_name?: string;
    extracted_content?: string;
  }>;
  files?: Array<{
    file_name?: string;
    file_kind?: string;
    preview_url?: string;
    document_asset?: { url?: string };
  }>;
}

/** Convert a raw claude.ai message into our model, preserving Markdown. */
function parseMessage(raw: RawMessage): ConversationMessage {
  let text = "";
  if (Array.isArray(raw.content) && raw.content.length > 0) {
    text = raw.content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n\n");
  }
  if (!text && typeof raw.text === "string") text = raw.text;

  const attachments: MessageAttachment[] = [];
  for (const a of raw.attachments ?? []) {
    attachments.push({
      fileName: a.file_name ?? "attachment",
      extractedContent: a.extracted_content ?? null,
      downloadUrl: null,
    });
  }
  for (const f of raw.files ?? []) {
    const url = f.document_asset?.url ?? f.preview_url ?? null;
    attachments.push({
      fileName: f.file_name ?? "file",
      extractedContent: null,
      downloadUrl: url,
    });
  }

  return {
    id: raw.uuid,
    sender: raw.sender === "human" ? "human" : "assistant",
    createdAt: raw.created_at ?? null,
    text: text.trim(),
    attachments,
  };
}
