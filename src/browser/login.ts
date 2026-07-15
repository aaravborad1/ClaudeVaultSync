import type { BrowserManager } from "./browser";
import { ClaudeClient } from "./claudeClient";
import { getLogger } from "../utils/logger";
import { sleep } from "../utils/retry";

/**
 * Ensure the browser session is authenticated. If not, bring the window to
 * the front and wait for the user to log in manually. We never ask for or
 * handle the user's credentials — the login happens entirely in the browser.
 */
export async function ensureLoggedIn(
  browser: BrowserManager,
  client: ClaudeClient,
  opts: { waitForUser: boolean; timeoutMinutes?: number } = { waitForUser: true }
): Promise<boolean> {
  const log = getLogger();

  if (await client.isLoggedIn()) {
    log.info("Claude session is authenticated");
    return true;
  }
  if (!opts.waitForUser) return false;

  log.info("Not logged in — please log into Claude in the browser window");
  console.log(
    "\n🔑  Please log into claude.ai in the browser window that just opened.\n" +
      "    ClaudeVaultSync will continue automatically once you're in.\n"
  );
  await browser.bringToFront();

  const deadline = Date.now() + (opts.timeoutMinutes ?? 15) * 60_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      if (await client.isLoggedIn()) {
        log.info("Login detected — session saved to persistent profile");
        console.log("✅  Logged in. Your session is saved for future launches.\n");
        return true;
      }
    } catch {
      // Browser may be mid-navigation; keep polling.
    }
  }
  log.warn("Timed out waiting for login");
  return false;
}
