import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { PROJECT_ROOT } from "../settings/settings";
import { getLogger } from "../utils/logger";

const PROFILE_DIR = path.join(PROJECT_ROOT, "browser-profile");
const CLAUDE_URL = "https://claude.ai";

/**
 * Manages the persistent Chromium instance. The browser profile (cookies,
 * localStorage) lives in browser-profile/ so a single manual login survives
 * across restarts. Recovers automatically if the browser crashes or is closed.
 */
export class BrowserManager {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private headless: boolean) {}

  /** Get a live page on claude.ai, launching or relaunching as needed. */
  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.context) return this.page;
    await this.launch();
    return this.page!;
  }

  private async launch(): Promise<void> {
    await this.close();
    getLogger().info("Launching browser with persistent profile");
    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: this.headless,
      viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.context.on("close", () => {
      this.context = null;
      this.page = null;
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.goto(CLAUDE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  /** Bring the window to the foreground so the user can log in. */
  async bringToFront(): Promise<void> {
    const page = await this.getPage();
    await page.bringToFront();
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Already closed / crashed — nothing to do.
      }
    }
    this.context = null;
    this.page = null;
  }
}
