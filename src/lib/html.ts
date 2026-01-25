/**
 * HTML log generation for ralph-review
 * Creates static HTML files for viewing logs in browser
 */

import { join } from "node:path";
import { readLog } from "./logger";
import type { LogEntry } from "./types";

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
 * Strip ANSI escape codes
 */
function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentional - matching ANSI escape codes requires control character \x1B
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Get icon for entry type
 */
function getTypeIcon(type: LogEntry["type"]): string {
  switch (type) {
    case "review":
      return "🔍";
    case "fix":
      return "🔧";
    case "system":
      return "⚙️";
  }
}

/**
 * Generate HTML from log entries
 */
export function generateLogHtml(entries: LogEntry[]): string {
  // Group entries by iteration
  const iterations = new Map<number, LogEntry[]>();
  for (const entry of entries) {
    const list = iterations.get(entry.iteration) || [];
    list.push(entry);
    iterations.set(entry.iteration, list);
  }

  let entriesHtml = "";

  if (entries.length === 0) {
    entriesHtml = '<p class="empty">No log entries</p>';
  } else {
    // Generate HTML for each iteration
    for (const [iteration, iterEntries] of iterations) {
      entriesHtml += `
      <details class="iteration" open>
        <summary>Iteration ${iteration}</summary>
        <div class="entries">
          ${iterEntries
            .map(
              (entry) => `
            <div class="entry entry-${entry.type}">
              <div class="entry-header">
                <span class="type">${getTypeIcon(entry.type)} ${entry.type}</span>
                <span class="time">${formatTimestamp(entry.timestamp)}</span>
              </div>
              <pre class="content">${escapeHtml(stripAnsi(entry.content))}</pre>
            </div>
          `
            )
            .join("")}
        </div>
      </details>
      `;
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
    .iteration {
      background: #16213e;
      border-radius: 8px;
      margin-bottom: 15px;
      overflow: hidden;
    }
    .iteration summary {
      background: #0f3460;
      padding: 12px 20px;
      cursor: pointer;
      font-weight: bold;
      color: #00d4ff;
    }
    .iteration summary:hover {
      background: #1a4a7a;
    }
    .entries {
      padding: 15px;
    }
    .entry {
      background: #1a1a2e;
      border-radius: 6px;
      margin-bottom: 10px;
      overflow: hidden;
    }
    .entry-header {
      display: flex;
      justify-content: space-between;
      padding: 8px 12px;
      background: #0f3460;
      font-size: 0.9em;
    }
    .entry-review .entry-header { border-left: 4px solid #00d4ff; }
    .entry-fix .entry-header { border-left: 4px solid #00ff88; }
    .entry-system .entry-header { border-left: 4px solid #888; }
    .type {
      font-weight: bold;
      text-transform: capitalize;
    }
    .time {
      color: #888;
    }
    .content {
      margin: 0;
      padding: 15px;
      overflow-x: auto;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-break: break-word;
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
 */
export async function writeLogHtml(sessionPath: string): Promise<void> {
  const entries = await readLog(sessionPath);
  const html = generateLogHtml(entries);
  const htmlPath = join(sessionPath, "log.html");
  await Bun.write(htmlPath, html);
}

/**
 * Get the HTML file path for a session
 */
export function getHtmlPath(sessionPath: string): string {
  return join(sessionPath, "log.html");
}
