import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Settings } from "../models/types";

export const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const CONFIG_DIR = path.join(PROJECT_ROOT, "config");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/** The permanent default vault destination: ~/My Second Brain/05 Claude Stuff/ */
export function defaultVaultPath(): string {
  return path.join(os.homedir(), "My Second Brain", "05 Claude Stuff");
}

export function defaultSettings(): Settings {
  return {
    vaultPath: defaultVaultPath(),
    intervalMinutes: 5,
    dashboardPort: 4823,
    headless: false,
  };
}

/** True when no config file exists yet (first launch). */
export function isFirstLaunch(): boolean {
  return !fs.existsSync(CONFIG_FILE);
}

export function loadSettings(): Settings {
  if (!fs.existsSync(CONFIG_FILE)) return defaultSettings();
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  return { ...defaultSettings(), ...raw };
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2));
}

export function configFilePath(): string {
  return CONFIG_FILE;
}
