/**
 * HTML log generation for ralph-review
 * Creates static HTML files for viewing logs in browser
 */

import { join } from "node:path";
import { readLog } from "./logger";
import type { DashboardData, IterationEntry, LogEntry, SystemEntry } from "./types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function isSystemEntry(entry: LogEntry): entry is SystemEntry {
  return entry.type === "system";
}

function isIterationEntry(entry: LogEntry): entry is IterationEntry {
  return entry.type === "iteration";
}

function renderSystemEntry(entry: SystemEntry): string {
  return `
    <div class="entry entry-system">
      <div class="entry-header">
        <span class="type">⚙️ Run Configuration</span>
        <span class="time">${formatTimestamp(entry.timestamp)}</span>
      </div>
      <div class="system-info">
        <p><strong>Project:</strong> ${escapeHtml(entry.projectPath)}</p>
        ${entry.gitBranch ? `<p><strong>Branch:</strong> ${escapeHtml(entry.gitBranch)}</p>` : ""}
        <p><strong>Reviewer:</strong> ${entry.reviewer.agent}${entry.reviewer.model ? ` (${entry.reviewer.model})` : ""}</p>
        <p><strong>Fixer:</strong> ${entry.fixer.agent}${entry.fixer.model ? ` (${entry.fixer.model})` : ""}</p>
        <p><strong>Max Iterations:</strong> ${entry.maxIterations}</p>
      </div>
    </div>
  `;
}

function renderIterationEntry(entry: IterationEntry): string {
  let statusIcon = "✅";
  let statusClass = "success";

  if (entry.error) {
    statusIcon = "❌";
    statusClass = "error";
  } else if (!entry.fixes) {
    statusIcon = "⚠️";
    statusClass = "warning";
  }

  let fixesHtml = "";
  if (entry.fixes) {
    const { fixes, skipped, decision } = entry.fixes;
    fixesHtml = `
      <div class="fixes-summary">
        <p><strong>Decision:</strong> ${decision}</p>
        ${fixes.length > 0 ? `<p><strong>Fixed:</strong> ${fixes.length} issue(s)</p>` : ""}
        ${skipped.length > 0 ? `<p><strong>Skipped:</strong> ${skipped.length} item(s)</p>` : ""}
      </div>
      ${
        fixes.length > 0
          ? `
        <details class="fixes-list">
          <summary>Fixed Issues (${fixes.length})</summary>
          <ul>
            ${fixes.map((f) => `<li><span class="priority priority-${f.priority.toLowerCase()}">${f.priority}</span> ${escapeHtml(f.title)}${f.file ? ` <code>${escapeHtml(f.file)}</code>` : ""}</li>`).join("")}
          </ul>
        </details>
      `
          : ""
      }
      ${
        skipped.length > 0
          ? `
        <details class="skipped-list">
          <summary>Skipped Items (${skipped.length})</summary>
          <ul>
            ${skipped.map((s) => `<li>${escapeHtml(s.title)} - <em>${escapeHtml(s.reason)}</em></li>`).join("")}
          </ul>
        </details>
      `
          : ""
      }
    `;
  }

  let errorHtml = "";
  if (entry.error) {
    errorHtml = `
      <div class="error-info">
        <p><strong>Phase:</strong> ${entry.error.phase}</p>
        <p><strong>Message:</strong> ${escapeHtml(entry.error.message)}</p>
        ${entry.error.exitCode !== undefined ? `<p><strong>Exit Code:</strong> ${entry.error.exitCode}</p>` : ""}
      </div>
    `;
  }

  return `
    <div class="entry entry-iteration entry-${statusClass}">
      <div class="entry-header">
        <span class="type">${statusIcon} Iteration ${entry.iteration}</span>
        <span class="time">${formatTimestamp(entry.timestamp)}${entry.duration ? ` (${(entry.duration / 1000).toFixed(1)}s)` : ""}</span>
      </div>
      ${fixesHtml}
      ${errorHtml}
    </div>
  `;
}

export function generateLogHtml(entries: LogEntry[]): string {
  let entriesHtml = "";

  if (entries.length === 0) {
    entriesHtml = '<p class="empty">No log entries</p>';
  } else {
    const systemEntry = entries.find(isSystemEntry);
    if (systemEntry) {
      entriesHtml += renderSystemEntry(systemEntry);
    }

    const iterationEntries = entries.filter(isIterationEntry);
    for (const entry of iterationEntries) {
      entriesHtml += renderIterationEntry(entry);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ralph-review Log</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      margin: 0;
      padding: 20px;
      line-height: 1.6;
    }
    h1 {
      color: #00d4ff;
      margin-bottom: 5px;
    }
    .meta {
      color: #888;
      margin-bottom: 20px;
    }
    .entry {
      background: #16213e;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      padding: 12px 20px;
      background: #0f3460;
      font-weight: bold;
    }
    .entry-success .entry-header { border-left: 4px solid #00ff88; }
    .entry-error .entry-header { border-left: 4px solid #ff4444; }
    .entry-warning .entry-header { border-left: 4px solid #ffaa00; }
    .entry-system .entry-header { border-left: 4px solid #00d4ff; }
    .type {
      color: #00d4ff;
    }
    .time {
      color: #888;
    }
    .system-info, .fixes-summary, .error-info {
      padding: 15px 20px;
    }
    .system-info p, .fixes-summary p, .error-info p {
      margin: 5px 0;
    }
    .fixes-list, .skipped-list {
      margin: 10px 20px;
    }
    .fixes-list summary, .skipped-list summary {
      cursor: pointer;
      padding: 8px;
      background: #0f3460;
      border-radius: 4px;
    }
    .fixes-list ul, .skipped-list ul {
      margin: 10px 0;
      padding-left: 25px;
    }
    .fixes-list li, .skipped-list li {
      margin: 5px 0;
    }
    .priority {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.8em;
      font-weight: bold;
      margin-right: 5px;
    }
    .priority-p0 { background: #ff4444; color: white; }
    .priority-p1 { background: #ffaa00; color: black; }
    .priority-p2 { background: #00d4ff; color: black; }
    .priority-p3 { background: #888; color: white; }
    /* Fallback for legacy/unknown priorities (e.g., P4+) */
    .priority-p4 { background: #666; color: white; }
    /* Generic fallback using contains selector for any unexpected priority class */
    .priority[class*="priority-"]:not(.priority-p0):not(.priority-p1):not(.priority-p2):not(.priority-p3):not(.priority-p4) { background: #666; color: white; }
    code {
      background: #0f3460;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
    }
    .error-info {
      background: rgba(255, 68, 68, 0.1);
    }
    .empty {
      text-align: center;
      color: #888;
      padding: 40px;
    }
  </style>
</head>
<body>
  <h1>ralph-review Log</h1>
  <p class="meta">Generated: ${formatTimestamp(Date.now())}</p>
  ${entriesHtml}
</body>
</html>`;
}

export async function writeLogHtml(logPath: string): Promise<void> {
  const entries = await readLog(logPath);
  const html = generateLogHtml(entries);
  const htmlPath = logPath.replace(/\.jsonl$/, ".html");
  await Bun.write(htmlPath, html);
}

export function getHtmlPath(logPath: string): string {
  return logPath.replace(/\.jsonl$/, ".html");
}

export function getDashboardPath(logsDir: string): string {
  return join(logsDir, "dashboard.html");
}

export function generateDashboardHtml(data: DashboardData): string {
  const dataJson = JSON.stringify(data).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RALPH // Code Review Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0a0a;
      --bg-secondary: #111111;
      --bg-tertiary: #1a1a1a;
      --text-primary: #f5f5f5;
      --text-secondary: #888888;
      --text-muted: #555555;
      --accent: #ff6b35;
      --accent-dim: #ff6b3533;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --border: #2a2a2a;
      --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
      --font-display: 'Playfair Display', Georgia, serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      font-size: 15px;
    }

    body {
      font-family: var(--font-mono);
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
      background-image:
        repeating-linear-gradient(
          0deg,
          transparent,
          transparent 1px,
          rgba(255,255,255,0.01) 1px,
          rgba(255,255,255,0.01) 2px
        );
    }

    /* Scanline overlay effect */
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        0deg,
        rgba(0,0,0,0.1) 0px,
        rgba(0,0,0,0.1) 1px,
        transparent 1px,
        transparent 2px
      );
      z-index: 9999;
    }

    ::selection {
      background: var(--accent);
      color: var(--bg-primary);
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
    }

    .logo {
      display: flex;
      align-items: baseline;
      gap: 0.75rem;
    }

    .logo-mark {
      font-family: var(--font-display);
      font-size: 1.75rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    .logo-mark span {
      color: var(--accent);
    }

    .logo-tagline {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--text-muted);
      border-left: 1px solid var(--border);
      padding-left: 0.75rem;
    }

    .header-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: right;
    }

    .header-meta strong {
      color: var(--accent);
    }

    /* Main Layout */
    .container {
      display: grid;
      grid-template-columns: 240px 320px 1fr;
      min-height: calc(100vh - 70px);
    }

    /* Projects Sidebar */
    .sidebar {
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
    }

    .sidebar-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sidebar-header h2 {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-muted);
      font-weight: 500;
    }

    .sidebar-header::before {
      content: '▸';
      color: var(--accent);
      font-size: 0.75rem;
    }

    .project-list {
      padding: 0.5rem 0;
    }

    .project-item {
      padding: 1rem 1.5rem;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: all 0.15s ease;
      position: relative;
    }

    .project-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0;
      background: var(--accent-dim);
      transition: width 0.15s ease;
    }

    .project-item:hover {
      background: var(--bg-tertiary);
    }

    .project-item:hover::before {
      width: 100%;
    }

    .project-item.selected {
      border-left-color: var(--accent);
      background: var(--bg-tertiary);
    }

    .project-item.selected::before {
      width: 100%;
    }

    .project-name {
      font-size: 0.9rem;
      font-weight: 500;
      margin-bottom: 0.25rem;
      position: relative;
      z-index: 1;
    }

    .project-stats {
      font-size: 0.75rem;
      color: var(--text-muted);
      position: relative;
      z-index: 1;
    }

    .project-stats strong {
      color: var(--accent);
      font-weight: 500;
    }

    /* Sessions Panel */
    .sessions-panel {
      background: var(--bg-primary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
    }

    .sessions-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sessions-header h2 {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-muted);
      font-weight: 500;
    }

    .sessions-header::before {
      content: '◆';
      color: var(--accent);
      font-size: 0.5rem;
    }

    .session-list {
      padding: 1rem;
    }

    .session-item {
      padding: 1rem 1.25rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      margin-bottom: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
      position: relative;
      overflow: hidden;
    }

    .session-item::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3px;
      height: 100%;
      background: var(--text-muted);
      transition: background 0.15s ease;
    }

    .session-item:hover {
      border-color: var(--text-muted);
      transform: translateX(2px);
    }

    .session-item.selected {
      border-color: var(--accent);
    }

    .session-item.selected::after {
      background: var(--accent);
    }

    .session-date {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }

    .session-branch {
      font-size: 0.85rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .session-branch::before {
      content: '⎇';
      color: var(--accent);
      font-size: 0.9rem;
    }

    .session-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0.5rem;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid;
    }

    .status-badge.completed {
      color: var(--success);
      border-color: var(--success);
    }

    .status-badge.running {
      color: var(--accent);
      border-color: var(--accent);
    }

    .status-badge.failed {
      color: var(--danger);
      border-color: var(--danger);
    }

    .status-badge.interrupted {
      color: var(--warning);
      border-color: var(--warning);
    }

    /* Main Content */
    .main-content {
      padding: 2.5rem;
      overflow-y: auto;
      background:
        linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-tertiary) 100%);
    }

    /* Hero Section */
    .hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 3rem;
      margin-bottom: 3rem;
      padding-bottom: 3rem;
      border-bottom: 1px solid var(--border);
    }

    .hero-main {
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .hero-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.25em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }

    .hero-number {
      font-family: var(--font-display);
      font-size: 7rem;
      font-weight: 900;
      line-height: 0.85;
      color: var(--text-primary);
      position: relative;
      display: inline-block;
    }

    .hero-number::after {
      content: '';
      position: absolute;
      bottom: -0.25rem;
      left: 0;
      width: 100%;
      height: 4px;
      background: var(--accent);
    }

    .hero-subtitle {
      font-size: 1.1rem;
      color: var(--text-secondary);
      margin-top: 1.25rem;
      font-weight: 400;
    }

    .hero-subtitle strong {
      color: var(--text-primary);
    }

    /* Priority Grid */
    .priority-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
    }

    .priority-cell {
      background: var(--bg-secondary);
      padding: 1.25rem;
      text-align: center;
    }

    .priority-level {
      font-size: 0.6rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 700;
      margin-bottom: 0.35rem;
    }

    .priority-level.p0 { color: var(--danger); }
    .priority-level.p1 { color: var(--warning); }
    .priority-level.p2 { color: var(--accent); }
    .priority-level.p3 { color: var(--text-muted); }

    .priority-value {
      font-family: var(--font-display);
      font-size: 2rem;
      font-weight: 700;
    }

    /* Stats Row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .stat-block {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      padding: 1.5rem;
      position: relative;
    }

    .stat-block::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
      opacity: 0.3;
    }

    .stat-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-family: var(--font-display);
      font-size: 2.25rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .stat-value.highlight {
      color: var(--accent);
    }

    /* Session Details */
    .details-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      margin-top: 2rem;
    }

    .details-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .details-header h3 {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--text-muted);
      font-weight: 500;
    }

    .details-content {
      padding: 1.5rem;
    }

    .fix-entry {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 1rem;
      align-items: start;
      padding: 0.85rem 0;
      border-bottom: 1px solid var(--border);
    }

    .fix-entry:last-child {
      border-bottom: none;
    }

    .fix-details {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .fix-priority {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.25rem 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 2rem;
      text-align: center;
    }

    .fix-priority.p0 { background: var(--danger); color: white; }
    .fix-priority.p1 { background: var(--warning); color: black; }
    .fix-priority.p2 { background: var(--accent); color: white; }
    .fix-priority.p3 { background: var(--text-muted); color: white; }
    /* Fallback for legacy/unknown priorities (e.g., P4+) */
    .fix-priority.p4, .fix-priority:not(.p0):not(.p1):not(.p2):not(.p3) { background: #555; color: white; }

    .fix-title {
      font-size: 0.85rem;
    }

    .fix-claim {
      font-size: 0.75rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .fix-file {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .section-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--accent);
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
    }

    .section-label.skipped-label {
      color: var(--text-muted);
      margin-top: 1.5rem;
    }

    .skip-entry {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      gap: 0.25rem 0.75rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
    }

    .skip-entry:last-child {
      border-bottom: none;
    }

    .skip-icon {
      color: var(--text-muted);
      font-size: 0.75rem;
      grid-row: span 2;
      padding-top: 0.15rem;
    }

    .skip-title {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .skip-reason {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-style: italic;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 3rem 1.5rem;
      color: var(--text-muted);
    }

    .empty-state p {
      font-size: 0.85rem;
    }

    .empty-state .icon {
      font-size: 2rem;
      margin-bottom: 1rem;
      opacity: 0.3;
    }

    /* Animations */
    @keyframes fadeSlideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .hero-number {
      animation: fadeSlideIn 0.5s ease-out;
    }

    .priority-cell {
      animation: fadeSlideIn 0.4s ease-out backwards;
    }

    .priority-cell:nth-child(1) { animation-delay: 0.1s; }
    .priority-cell:nth-child(2) { animation-delay: 0.15s; }
    .priority-cell:nth-child(3) { animation-delay: 0.2s; }
    .priority-cell:nth-child(4) { animation-delay: 0.25s; }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    ::-webkit-scrollbar-track {
      background: var(--bg-primary);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border);
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="logo">
      <div class="logo-mark">RALPH<span>//</span></div>
      <div class="logo-tagline">Code Review Dashboard</div>
    </div>
    <div class="header-meta">
      <div><strong>${data.globalStats.totalSessions}</strong> sessions tracked</div>
    </div>
  </header>

  <div class="container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>Projects</h2>
      </div>
      <div class="project-list" id="projects-list"></div>
    </aside>

    <div class="sessions-panel">
      <div class="sessions-header">
        <h2>Sessions</h2>
      </div>
      <div class="session-list" id="sessions-list"></div>
    </div>

    <main class="main-content" id="main-content">
      <div class="hero">
        <div class="hero-main">
          <div class="hero-label">Issues Resolved</div>
          <div class="hero-number" id="hero-number">${data.globalStats.totalFixes}</div>
          <div class="hero-subtitle">across <strong id="project-count">${data.projects.length}</strong> projects</div>
        </div>
        <div class="priority-grid" id="priority-grid">
          <div class="priority-cell">
            <div class="priority-level p0">Critical</div>
            <div class="priority-value" id="p0-count">${data.globalStats.priorityCounts.P0}</div>
          </div>
          <div class="priority-cell">
            <div class="priority-level p1">High</div>
            <div class="priority-value" id="p1-count">${data.globalStats.priorityCounts.P1}</div>
          </div>
          <div class="priority-cell">
            <div class="priority-level p2">Medium</div>
            <div class="priority-value" id="p2-count">${data.globalStats.priorityCounts.P2}</div>
          </div>
          <div class="priority-cell">
            <div class="priority-level p3">Low</div>
            <div class="priority-value" id="p3-count">${data.globalStats.priorityCounts.P3}</div>
          </div>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-block">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value highlight" id="success-rate">${data.globalStats.successRate}%</div>
        </div>
        <div class="stat-block">
          <div class="stat-label">Total Sessions</div>
          <div class="stat-value" id="total-sessions">${data.globalStats.totalSessions}</div>
        </div>
        <div class="stat-block">
          <div class="stat-label">Skipped Items</div>
          <div class="stat-value" id="total-skipped">${data.globalStats.totalSkipped}</div>
        </div>
      </div>

      <div id="session-details"></div>
    </main>
  </div>

  <script>
    const dashboardData = ${dataJson};
    let selectedProject = dashboardData.currentProject || (dashboardData.projects[0]?.projectName) || null;
    let selectedSessionIndex = null;

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function getStatusBadge(status) {
      const labels = {
        running: 'RUN',
        completed: 'OK',
        failed: 'FAIL',
        interrupted: 'STOP'
      };
      return '<span class="status-badge ' + status + '">' + (labels[status] || status) + '</span>';
    }

    function formatDate(timestamp) {
      const d = new Date(timestamp);
      const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const day = d.getDate();
      const year = d.getFullYear();
      const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return month + ' ' + day + ', ' + year + ' · ' + time;
    }

    function renderProjects() {
      const container = document.getElementById('projects-list');
      if (dashboardData.projects.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="icon">◇</div><p>No projects yet</p></div>';
        return;
      }

      let html = '';
      for (let i = 0; i < dashboardData.projects.length; i++) {
        const p = dashboardData.projects[i];
        const isSelected = p.projectName === selectedProject;
        html += '<div class="project-item' + (isSelected ? ' selected' : '') + '" data-project="' + i + '">';
        html += '<div class="project-name">' + escapeHtml(p.displayName) + '</div>';
        html += '<div class="project-stats"><strong>' + p.totalFixes + '</strong> fixes · ' + p.sessionCount + ' sessions</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function renderSessions() {
      const container = document.getElementById('sessions-list');
      const project = dashboardData.projects.find(function(p) { return p.projectName === selectedProject; });

      if (!project || project.sessions.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="icon">◇</div><p>No sessions</p></div>';
        return;
      }

      let html = '';
      for (let i = 0; i < project.sessions.length; i++) {
        const s = project.sessions[i];
        const isSelected = selectedSessionIndex === i;
        html += '<div class="session-item' + (isSelected ? ' selected' : '') + '" data-session="' + i + '">';
        html += '<div class="session-date">' + formatDate(s.timestamp) + '</div>';
        html += '<div class="session-branch">' + escapeHtml(s.gitBranch || 'no branch') + '</div>';
        html += '<div class="session-meta">';
        html += getStatusBadge(s.status);
        html += '<span>' + s.totalFixes + ' fixes</span>';
        html += '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function renderMainContent() {
      const project = dashboardData.projects.find(function(p) { return p.projectName === selectedProject; });

      if (project) {
        document.getElementById('hero-number').textContent = project.totalFixes;
        document.getElementById('p0-count').textContent = project.priorityCounts.P0;
        document.getElementById('p1-count').textContent = project.priorityCounts.P1;
        document.getElementById('p2-count').textContent = project.priorityCounts.P2;
        document.getElementById('p3-count').textContent = project.priorityCounts.P3;

        const successRate = project.sessionCount > 0
          ? Math.round((project.successCount / project.sessionCount) * 100)
          : 0;
        document.getElementById('success-rate').textContent = successRate + '%';
        document.getElementById('total-sessions').textContent = project.sessionCount;
        document.getElementById('total-skipped').textContent = project.totalSkipped;
      }
    }

    function renderSessionDetails() {
      const container = document.getElementById('session-details');
      const project = dashboardData.projects.find(function(p) { return p.projectName === selectedProject; });

      if (!project || selectedSessionIndex === null || !project.sessions[selectedSessionIndex]) {
        container.innerHTML = '';
        return;
      }

      const session = project.sessions[selectedSessionIndex];
      let html = '<div class="details-section">';
      html += '<div class="details-header"><h3>Session Details</h3>';
      html += '<span>' + escapeHtml(session.gitBranch || 'no branch') + ' · ' + session.iterations + ' iterations</span>';
      html += '</div>';
      html += '<div class="details-content">';

      // Find iteration entries with fixes or skipped
      var allFixes = [];
      var allSkipped = [];

      for (var i = 0; i < session.entries.length; i++) {
        var entry = session.entries[i];
        if (entry.type === 'iteration' && entry.fixes) {
          if (entry.fixes.fixes && entry.fixes.fixes.length > 0) {
            for (var j = 0; j < entry.fixes.fixes.length; j++) {
              allFixes.push(entry.fixes.fixes[j]);
            }
          }
          if (entry.fixes.skipped && entry.fixes.skipped.length > 0) {
            for (var k = 0; k < entry.fixes.skipped.length; k++) {
              allSkipped.push(entry.fixes.skipped[k]);
            }
          }
        }
      }

      if (allFixes.length === 0 && allSkipped.length === 0) {
        html += '<div class="empty-state"><p>No fixes or skipped items in this session</p></div>';
      } else {
        // Render fixes
        if (allFixes.length > 0) {
          html += '<div class="section-label">Fixed (' + allFixes.length + ')</div>';
          for (var fi = 0; fi < allFixes.length; fi++) {
            var fix = allFixes[fi];
            var priority = fix.priority;
            html += '<div class="fix-entry">';
            html += '<span class="fix-priority ' + escapeHtml(priority).toLowerCase() + '">' + escapeHtml(priority) + '</span>';
            html += '<div class="fix-details">';
            html += '<span class="fix-title">' + escapeHtml(fix.title) + '</span>';
            if (fix.claim) {
              html += '<span class="fix-claim">' + escapeHtml(fix.claim) + '</span>';
            }
            html += '</div>';
            html += '<span class="fix-file">' + (fix.file ? escapeHtml(fix.file) : '') + '</span>';
            html += '</div>';
          }
        }

        // Render skipped
        if (allSkipped.length > 0) {
          html += '<div class="section-label skipped-label">Skipped (' + allSkipped.length + ')</div>';
          for (var si = 0; si < allSkipped.length; si++) {
            var skipped = allSkipped[si];
            html += '<div class="skip-entry">';
            html += '<span class="skip-icon">○</span>';
            html += '<span class="skip-title">' + escapeHtml(skipped.title) + '</span>';
            html += '<span class="skip-reason">' + escapeHtml(skipped.reason) + '</span>';
            html += '</div>';
          }
        }
      }

      html += '</div></div>';
      container.innerHTML = html;
    }

    function selectProject(index) {
      const project = dashboardData.projects[index];
      if (project) {
        selectedProject = project.projectName;
        selectedSessionIndex = null;
        renderProjects();
        renderSessions();
        renderMainContent();
        renderSessionDetails();
      }
    }

    function selectSession(index) {
      selectedSessionIndex = index;
      renderSessions();
      renderSessionDetails();
    }

    // Event delegation for project clicks
    document.getElementById('projects-list').addEventListener('click', function(e) {
      const item = e.target.closest('.project-item');
      if (item) {
        const index = parseInt(item.getAttribute('data-project'), 10);
        selectProject(index);
      }
    });

    // Event delegation for session clicks
    document.getElementById('sessions-list').addEventListener('click', function(e) {
      const item = e.target.closest('.session-item');
      if (item) {
        const index = parseInt(item.getAttribute('data-session'), 10);
        selectSession(index);
      }
    });

    // Initial render
    renderProjects();
    renderSessions();
    renderMainContent();
  </script>
</body>
</html>`;
}

export async function writeDashboardHtml(htmlPath: string, data: DashboardData): Promise<void> {
  const html = generateDashboardHtml(data);
  await Bun.write(htmlPath, html);
}
