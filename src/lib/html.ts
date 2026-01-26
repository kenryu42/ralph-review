/**
 * HTML log generation for ralph-review
 * Creates static HTML files for viewing logs in browser
 */

import { readLog } from "./logger";
import type { IterationEntry, LogEntry, SystemEntry } from "./types";

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Type guard for SystemEntry
 */
function isSystemEntry(entry: LogEntry): entry is SystemEntry {
  return entry.type === "system";
}

/**
 * Type guard for IterationEntry
 */
function isIterationEntry(entry: LogEntry): entry is IterationEntry {
  return entry.type === "iteration";
}

/**
 * Render system entry (run configuration)
 */
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

/**
 * Render iteration entry (fix results)
 */
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
            ${fixes.map((f) => `<li><span class="severity severity-${f.severity.toLowerCase()}">${f.severity}</span> ${escapeHtml(f.title)}${f.file ? ` <code>${escapeHtml(f.file)}</code>` : ""}</li>`).join("")}
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

/**
 * Generate HTML from log entries
 */
export function generateLogHtml(entries: LogEntry[]): string {
  let entriesHtml = "";

  if (entries.length === 0) {
    entriesHtml = '<p class="empty">No log entries</p>';
  } else {
    // Render system entry first (if present)
    const systemEntry = entries.find(isSystemEntry);
    if (systemEntry) {
      entriesHtml += renderSystemEntry(systemEntry);
    }

    // Render iteration entries
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
    .severity {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.8em;
      font-weight: bold;
      margin-right: 5px;
    }
    .severity-high { background: #ff4444; color: white; }
    .severity-med { background: #ffaa00; color: black; }
    .severity-low { background: #00d4ff; color: black; }
    .severity-nit { background: #888; color: white; }
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

/**
 * Write HTML log file for a session
 * Places HTML file next to the JSONL log file
 */
export async function writeLogHtml(logPath: string): Promise<void> {
  const entries = await readLog(logPath);
  const html = generateLogHtml(entries);
  const htmlPath = logPath.replace(/\.jsonl$/, ".html");
  await Bun.write(htmlPath, html);
}

/**
 * Get the HTML file path for a log session
 */
export function getHtmlPath(logPath: string): string {
  return logPath.replace(/\.jsonl$/, ".html");
}
