# ClaudeVaultSync

Synchronizes your Claude conversations into your Obsidian vault as clean,
searchable Markdown notes. Completely local — no telemetry, no cloud, nothing
leaves your machine.

## How it works

A persistent Chromium window holds your own authenticated claude.ai session
(you log in manually, once). Every 5 minutes the sync engine lists your
conversations through that session, downloads only the new or changed ones,
renders them to Markdown with YAML front matter, and writes them into:

```
~/Second Brain/05 Claude Chats/<YYYY>/<MM>/<Title>.md
```

Attachments go to `05 Claude Chats/Assets/` and are embedded from the notes.
A SQLite database (`database/claudevaultsync.db`) tracks hashes so unchanged
conversations are never rewritten, duplicates are impossible, and renamed
conversations move their note with them.

## Requirements

- macOS with [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)

## Setup

```sh
bun install
bunx playwright install chromium   # one-time browser download
```

## Run

```sh
bun start
```

1. On first launch you'll be asked to confirm the Obsidian folder
   (Enter accepts the default).
2. A browser window opens on claude.ai — log in normally. Your session is
   saved to `browser-profile/`, so this is a one-time step.
3. Leave it running. The dashboard is at <http://localhost:4823> with
   Sync Now / Pause / Resume / Open Obsidian Folder controls.

## Configuration

`config/config.json` (created on first run):

| Key               | Default                                  | Meaning                    |
| ----------------- | ---------------------------------------- | -------------------------- |
| `vaultPath`       | `~/Second Brain/05 Claude Chats`         | Where notes are written    |
| `intervalMinutes` | `5`                                      | Sync interval (hot-reloads)|
| `dashboardPort`   | `4823`                                   | Local dashboard port       |
| `headless`        | `false`                                  | Keep `false` so you can log in |

## Layout

```
src/
  browser/    Chromium lifecycle, login flow, claude.ai session client
  sync/       discovery, download, change detection, sync engine
  markdown/   conversation → Markdown note rendering
  obsidian/   vault paths, atomic writes, renames, assets
  database/   SQLite (conversations, messages, sync history)
  scheduler/  5-minute loop, pause/resume, sync-now
  dashboard/  local status UI
  settings/   config load/save
```

## Logs

Daily log files in `logs/`. Each run records checked / new / updated /
skipped / errors, and the same summary shows on the dashboard.

## Reliability notes

- Notes are written atomically (temp file + rename) — an interrupted sync can
  never leave a half-written note.
- If the browser crashes it is relaunched automatically on the next run.
- If your session expires, the app flips to “login required”, brings the
  browser window forward, and resumes syncing by itself once you log back in.
