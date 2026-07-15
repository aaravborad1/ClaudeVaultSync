import type { SyncEngine } from "../sync/syncEngine";
import type { SyncRunResult, SyncStatus } from "../models/types";
import { getLogger } from "../utils/logger";

/**
 * Runs the sync engine on a fixed interval (default every 5 minutes), with
 * pause/resume and manual "sync now" support. If a run reports an expired
 * session the scheduler flips to login-required and keeps checking — the
 * moment the user logs back in, syncing resumes on its own.
 */
export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalMs: number;
  private paused = false;
  private status: SyncStatus = "idle";
  private lastResult: SyncRunResult | null = null;
  private nextRunAt: Date | null = null;
  private onLoginRequired?: () => void;

  constructor(
    private engine: SyncEngine,
    intervalMinutes: number,
    hooks?: { onLoginRequired?: () => void }
  ) {
    this.intervalMs = intervalMinutes * 60_000;
    this.onLoginRequired = hooks?.onLoginRequired;
  }

  start(): void {
    getLogger().info(
      { intervalMinutes: this.intervalMs / 60_000 },
      "Scheduler started"
    );
    void this.runAndReschedule();
  }

  setIntervalMinutes(minutes: number): void {
    if (minutes < 1) return;
    this.intervalMs = minutes * 60_000;
    getLogger().info({ minutes }, "Sync interval updated");
    if (!this.paused && this.status !== "syncing") this.schedule();
  }

  pause(): void {
    this.paused = true;
    this.status = "paused";
    this.clearTimer();
    this.nextRunAt = null;
    getLogger().info("Scheduler paused");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.status = "idle";
    getLogger().info("Scheduler resumed");
    void this.runAndReschedule();
  }

  /** Trigger an immediate run (no-op if one is already in flight). */
  syncNow(): void {
    if (this.engine.isRunning()) return;
    this.clearTimer();
    void this.runAndReschedule();
  }

  getState(): {
    status: SyncStatus;
    lastResult: SyncRunResult | null;
    nextRunAt: string | null;
    intervalMinutes: number;
  } {
    return {
      status: this.status,
      lastResult: this.lastResult,
      nextRunAt: this.nextRunAt ? this.nextRunAt.toISOString() : null,
      intervalMinutes: this.intervalMs / 60_000,
    };
  }

  /** Called by the app once the user has re-authenticated. */
  notifyLoggedIn(): void {
    if (this.status === "login-required") {
      this.status = "idle";
      if (!this.paused) void this.runAndReschedule();
    }
  }

  stop(): void {
    this.clearTimer();
  }

  private async runAndReschedule(): Promise<void> {
    if (this.paused) return;
    this.status = "syncing";
    try {
      this.lastResult = await this.engine.run();
      if (this.lastResult.status === "login-required") {
        this.status = "login-required";
        this.onLoginRequired?.();
      } else if (this.lastResult.status === "failed") {
        this.status = "error";
      } else {
        this.status = "idle";
      }
    } catch (err) {
      getLogger().error({ err: String(err) }, "Scheduler run crashed");
      this.status = "error";
    }
    if (!this.paused) this.schedule();
  }

  private schedule(): void {
    this.clearTimer();
    this.nextRunAt = new Date(Date.now() + this.intervalMs);
    this.timer = setTimeout(() => void this.runAndReschedule(), this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
