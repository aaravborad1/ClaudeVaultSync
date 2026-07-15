# ClaudeVaultSync — Project Specification & Implementation Plan

You are the lead software engineer responsible for designing and building this application from start to finish. This document is the single source of truth: it defines what the product must do (Goals) and how to build it (Implementation Phases).

---

## Part 1 — Goals

### Mission

Build a production-quality macOS application called **ClaudeVaultSync** whose sole purpose is to create a complete, searchable local archive of my own Claude conversations inside my Obsidian vault.

Whenever I use Claude — from my Mac, browser, phone, or any other device — those conversations should eventually synchronize into my local Obsidian vault once they are available through my authenticated Claude account. The application automates this through my own authorized browser session. It must never attempt to bypass authentication, security, or access controls.

The result should feel like Claude has native Obsidian synchronization.

### Permanent Storage Location

All conversations MUST be stored inside:

```text
aaravborad/
└── Second Brain/
    └── 05 Claude Chats/
```

Never save conversation files anywhere else, except temporary working files.

### Design Philosophy

The software must be:

- reliable
- modular
- maintainable
- production quality
- efficient
- resilient
- privacy-first
- completely local

Design everything so I can use this application for years. It should become my permanent archive for every Claude conversation, continuously building a knowledge base that integrates naturally with Obsidian — every conversation a properly formatted Markdown note that is searchable, linkable, and easy to organize.

### User Experience

I should only ever need to:

1. Launch the app once.
2. Log into Claude once using the browser.
3. Leave the application running.

From then on, the application automatically detects new conversations, detects updated conversations, synchronizes changes, and writes Markdown notes into my vault. Near-zero manual work after setup.

### Content Fidelity

Every synced conversation must preserve:

- titles, headings, paragraphs
- numbered lists and bullet lists
- code blocks and inline code
- tables
- Markdown formatting
- math and blockquotes
- timestamps when available
- downloadable attachments when available through the interface

Output must look clean inside Obsidian with no manual editing required.

### Synchronization Behavior

- No duplicate notes.
- Detect renamed conversations.
- Detect changed conversations.
- Avoid unnecessary rewrites — if nothing changed, nothing is rewritten.
- Incremental sync; never rebuild everything from scratch.

### Reliability

Recover gracefully — with no data loss and no corrupted notes — from:

- internet outages
- expired login sessions
- browser crashes
- interrupted synchronization
- unexpected shutdowns

### Performance

Comfortably support thousands of conversations. Only process what changed.

### Privacy

Everything remains on my computer. No telemetry, no analytics, no external cloud services, no uploading conversations anywhere, no third-party storage.

### Architecture

Clean, modular, documented code. Browser automation, synchronization, Markdown generation, database management, scheduling, and UI are independent components. Design so future features can be added without major refactoring.

### Future Expansion (do not build now; do not compromise the core for these)

AI-generated summaries, automatic tags, backlinks, Obsidian graph enhancements, full-text search, daily-note integration, Git versioning, export formats, advanced filters.

### Success Criteria

The project succeeds when I can use Claude normally and my conversations automatically appear in `aaravborad/Second Brain/05 Claude Chats/` as clean, searchable Markdown notes with minimal ongoing effort.

---

## Part 2 — Implementation Phases

### Phase 1 — Create the Project

Create a new project called `ClaudeVaultSync`.

Initialize with:

- Node.js
- TypeScript
- Playwright (install Chromium)
- Better SQLite3
- Pino
- Gray Matter
- Chokidar

### Phase 2 — Project Structure

```text
ClaudeVaultSync/

src/
│
├── browser/
│     browser.ts
│     login.ts
│
├── sync/
│     syncEngine.ts
│     discoverConversations.ts
│     downloadConversation.ts
│     compareHashes.ts
│
├── markdown/
│     markdownWriter.ts
│
├── database/
│     sqlite.ts
│
├── obsidian/
│     vault.ts
│
├── scheduler/
│     scheduler.ts
│
├── settings/
│     settings.ts
│
├── models/
│
├── utils/
│
└── index.ts

browser-profile/
config/
logs/
database/
temp/
```

### Phase 3 — First Launch

On first launch, ask the user for the Obsidian folder, defaulting to:

```text
aaravborad/Second Brain/05 Claude Chats/
```

If it doesn't exist, create it.

### Phase 4 — Login

- Launch Playwright with a **persistent browser profile** (`browser-profile/`).
- Open `https://claude.ai`.
- Wait for the user to log in manually. **Never ask for email or password.**
- After login, the profile persists; future launches reuse the saved session automatically.
- Never bypass authentication, security, or access controls.

### Phase 5 — Scheduler

Create a scheduler. Default interval: **every 5 minutes**.

Every run:

```
Open Claude
  ↓
Check conversation list
  ↓
Find new conversations
  ↓
Find changed conversations
  ↓
Ignore unchanged conversations
```

### Phase 6 — Discover Conversations

Read every conversation visible in the account. Collect per conversation:

- Title
- Stable conversation identifier (if available through the UI)
- Last-updated information (if available)
- URL
- Content hash

Save metadata into SQLite.

### Phase 7 — Download Conversation

For every new or changed conversation, open it and extract with formatting preserved:

- User messages and Claude messages
- Headings, lists, tables
- Code blocks, inline code
- Math, blockquotes
- Attachments (when available)

### Phase 8 — Convert to Markdown

Generate notes in this shape:

```markdown
---
title:
conversation_id:
created:
updated:
last_sync:
source: Claude
tags:
 - claude
---

# Conversation

## User

...

## Claude

...
```

Keep all code fences and Markdown formatting intact. Include created/updated dates and conversation identifier in front matter when available.

### Phase 9 — Save into Obsidian

Always save under `aaravborad/Second Brain/05 Claude Chats/`, organized Year → Month → Note:

```text
05 Claude Chats/
  2026/
    07/
      Trading Agent Ideas.md
      Genesis+.md
      AI Research.md
```

Create missing folders automatically.

### Phase 10 — Assets

Create `05 Claude Chats/Assets/`. When conversations include downloadable attachments accessible through the interface, save them there and reference them from the Markdown notes.

### Phase 11 — SQLite

Tables: `Conversations`, `Messages`, `SyncHistory`.

Store conversation metadata, local file path, content hash, and last-sync time. This is what prevents duplicate notes.

### Phase 12 — Detect Changes

Every sync, compare newly extracted content against the stored hash:

- Unchanged → skip (no file write).
- Changed → update the Markdown file and the database.

### Phase 13 — Rename Detection

If a conversation's title changes, rename the Markdown file while keeping the same metadata and identity (no duplicate note).

### Phase 14 — Logging

Log every sync run to `logs/` (Pino). Example summary:

```
12:00 PM
Checked: 214 conversations
Downloaded: 3
Updated: 5
Skipped: 206
Errors: 0
```

### Phase 15 — Dashboard

Small desktop interface showing:

- Last sync
- Next sync
- Sync status
- Number of conversations
- **Sync Now** button
- **Pause** / **Resume** buttons
- **Open Obsidian Folder** button

### Phase 16 — Reliability

Automatically recover from internet disconnects, browser crashes, expired login sessions, and interrupted syncs. Resume without corrupting notes; a failed sync must never lose data.

### Phase 17 — Performance

- Only process conversations that changed.
- Support thousands of conversations.
- Never rewrite every Markdown file on every sync — incremental always.

### Phase 18 — Final Result

```
Claude opens
  ↓
I chat normally on ANY device
  ↓
The scheduler runs every 5 minutes
  ↓
It checks my account
  ↓
New conversations are detected
  ↓
Changed conversations are detected
  ↓
Markdown files are updated
  ↓
Everything appears automatically in:

aaravborad/
└── Second Brain/
    └── 05 Claude Chats/
```
