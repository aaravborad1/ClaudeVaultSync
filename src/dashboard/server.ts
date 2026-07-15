import http from "node:http";
import { exec } from "node:child_process";
import type { Scheduler } from "../scheduler/scheduler";
import type { SyncDatabase } from "../database/sqlite";
import type { Vault } from "../obsidian/vault";
import { getLogger } from "../utils/logger";

/**
 * Tiny local dashboard (http://localhost:<port>) — completely local, no
 * external services. Shows sync status and offers Sync Now / Pause / Resume /
 * Open Obsidian Folder controls.
 */
export function startDashboard(
  scheduler: Scheduler,
  db: SyncDatabase,
  vault: Vault,
  port: number
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const state = scheduler.getState();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ...state,
          conversationCount: db.countConversations(),
          vaultPath: vault.rootDir(),
        })
      );
      return;
    }

    if (req.method === "POST") {
      switch (url.pathname) {
        case "/api/sync-now":
          scheduler.syncNow();
          return ok(res);
        case "/api/pause":
          scheduler.pause();
          return ok(res);
        case "/api/resume":
          scheduler.resume();
          return ok(res);
        case "/api/open-folder":
          exec(`open ${JSON.stringify(vault.rootDir())}`);
          return ok(res);
      }
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "127.0.0.1", () => {
    getLogger().info({ port }, "Dashboard running");
    console.log(`📊  Dashboard: http://localhost:${port}\n`);
  });
  return server;
}

function ok(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClaudeVaultSync</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #faf9f5; --card: #ffffff; --text: #1a1915; --muted: #6e6b60;
    --accent: #c15f3c; --border: #e8e6dd; --ok: #2e7d32; --warn: #b26a00; --err: #c62828;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1a1915; --card: #262521; --text: #f0efea; --muted: #a3a094;
            --border: #3a382f; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
         background: var(--bg); color: var(--text);
         display: grid; place-items: center; min-height: 100vh; padding: 24px; }
  .card { background: var(--card); border: 1px solid var(--border);
          border-radius: 16px; padding: 28px 32px; width: min(440px, 100%);
          box-shadow: 0 4px 24px rgba(0,0,0,.06); }
  h1 { font-size: 20px; margin-bottom: 2px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px;
         overflow-wrap: anywhere; }
  .row { display: flex; justify-content: space-between; padding: 9px 0;
         border-bottom: 1px solid var(--border); font-size: 14px; }
  .row:last-of-type { border-bottom: 0; }
  .row .k { color: var(--muted); }
  .status { font-weight: 600; }
  .status.idle { color: var(--ok); } .status.syncing { color: var(--accent); }
  .status.paused { color: var(--warn); } .status.login-required,
  .status.error { color: var(--err); }
  .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
             margin-top: 22px; }
  button { font: inherit; font-weight: 600; padding: 10px 14px;
           border-radius: 10px; border: 1px solid var(--border);
           background: var(--card); color: var(--text); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent);
                   color: #fff; }
  .summary { margin-top: 18px; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div class="card">
  <h1>ClaudeVaultSync</h1>
  <div class="sub" id="vault"></div>
  <div class="row"><span class="k">Status</span><span class="status" id="status">…</span></div>
  <div class="row"><span class="k">Last sync</span><span id="last">–</span></div>
  <div class="row"><span class="k">Next sync</span><span id="next">–</span></div>
  <div class="row"><span class="k">Conversations</span><span id="count">–</span></div>
  <div class="buttons">
    <button class="primary" onclick="act('sync-now')">Sync Now</button>
    <button id="pauseBtn" onclick="togglePause()">Pause</button>
    <button onclick="act('open-folder')">Open Obsidian Folder</button>
    <button onclick="refresh()">Refresh</button>
  </div>
  <div class="summary" id="summary"></div>
</div>
<script>
let paused = false;
function fmt(iso) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
}
async function refresh() {
  try {
    const s = await (await fetch('/api/status')).json();
    paused = s.status === 'paused';
    document.getElementById('status').textContent = s.status;
    document.getElementById('status').className = 'status ' + s.status;
    document.getElementById('vault').textContent = s.vaultPath;
    document.getElementById('count').textContent = s.conversationCount;
    document.getElementById('next').textContent = paused ? 'paused' : fmt(s.nextRunAt);
    document.getElementById('pauseBtn').textContent = paused ? 'Resume' : 'Pause';
    const r = s.lastResult;
    document.getElementById('last').textContent = r ? fmt(r.finishedAt) : 'never';
    document.getElementById('summary').textContent = r
      ? \`Checked \${r.checked} · New \${r.downloaded} · Updated \${r.updated} · Skipped \${r.skipped} · Errors \${r.errors}\`
      : 'No sync has run yet.';
  } catch { document.getElementById('status').textContent = 'offline'; }
}
async function act(name) { await fetch('/api/' + name, {method:'POST'}); refresh(); }
async function togglePause() { await act(paused ? 'resume' : 'pause'); }
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
