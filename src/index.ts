import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import chokidar from "chokidar";
import {
  PROJECT_ROOT,
  loadSettings,
  saveSettings,
  isFirstLaunch,
  defaultVaultPath,
  configFilePath,
} from "./settings/settings";
import { initLogger } from "./utils/logger";
import { SyncDatabase } from "./database/sqlite";
import { Vault } from "./obsidian/vault";
import { BrowserManager } from "./browser/browser";
import { ClaudeClient } from "./browser/claudeClient";
import { ensureLoggedIn } from "./browser/login";
import { SyncEngine } from "./sync/syncEngine";
import { Scheduler } from "./scheduler/scheduler";
import { startDashboard } from "./dashboard/server";

async function main(): Promise<void> {
  console.log("\n🗂  ClaudeVaultSync — your Claude conversations, in Obsidian.\n");

  const log = initLogger(path.join(PROJECT_ROOT, "logs"));
  let settings = loadSettings();

  // First launch: confirm the Obsidian destination (Enter accepts the default).
  if (isFirstLaunch()) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = (
      await rl.question(
        `Obsidian folder for Claude chats\n  [${defaultVaultPath()}]\n> `
      )
    ).trim();
    rl.close();
    if (answer) settings.vaultPath = answer;
    saveSettings(settings);
    log.info({ vaultPath: settings.vaultPath }, "Settings saved");
  }

  const vault = new Vault(settings.vaultPath, path.join(PROJECT_ROOT, "temp"));
  vault.ensureBaseDirs();
  console.log(`📁  Vault destination: ${settings.vaultPath}`);

  const db = new SyncDatabase(path.join(PROJECT_ROOT, "database"));
  const browser = new BrowserManager(settings.headless);
  const client = new ClaudeClient(browser);
  const engine = new SyncEngine(client, db, vault);

  const scheduler = new Scheduler(engine, settings.intervalMinutes, {
    onLoginRequired: () => {
      // Session expired mid-flight: surface the browser and wait for the
      // user, then resume automatically.
      void (async () => {
        client.reset();
        const ok = await ensureLoggedIn(browser, client, {
          waitForUser: true,
          timeoutMinutes: 60,
        });
        if (ok) scheduler.notifyLoggedIn();
      })();
    },
  });

  // Dashboard comes up immediately so status is visible even during login.
  const dashboard = startDashboard(scheduler, db, vault, settings.dashboardPort);

  // Live-reload the sync interval if config.json is edited while running.
  chokidar.watch(configFilePath(), { ignoreInitial: true }).on("change", () => {
    try {
      const next = loadSettings();
      if (next.intervalMinutes !== settings.intervalMinutes) {
        scheduler.setIntervalMinutes(next.intervalMinutes);
      }
      settings = next;
    } catch (err) {
      log.warn({ err: String(err) }, "Failed to reload config");
    }
  });

  // Log in (manual, in the browser window) then start the 5-minute loop.
  const loggedIn = await ensureLoggedIn(browser, client, {
    waitForUser: true,
    timeoutMinutes: 30,
  });
  if (!loggedIn) {
    console.log(
      "⚠️  No login detected. Leave the app running and log in whenever " +
        "you're ready — syncing will start on the next check."
    );
  }
  scheduler.start();

  const shutdown = async () => {
    console.log("\nShutting down…");
    scheduler.stop();
    dashboard.close();
    await browser.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
