import { LOG_CSS } from "@/lib/html/log/styles";
import { getPriorityPillClass } from "@/lib/html/priority";
import { escapeHtml, formatDate, formatDuration } from "@/lib/html/shared";
import type {
  AgentSettings,
  FixEntry,
  IterationEntry,
  LogEntry,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";

function formatAgent(settings: AgentSettings | undefined): string {
  if (!settings) return "unknown";
  return settings.model ? `${settings.agent} (${settings.model})` : settings.agent;
}

function isCodeSimplified(systemEntry: SystemEntry | undefined): boolean {
  if (!systemEntry) return false;
  return Boolean(systemEntry.codeSimplifier || systemEntry.reviewOptions?.simplifier);
}

function renderFixEntry(fix: FixEntry): string {
  const file = fix.file ? `<span class="muted">${escapeHtml(fix.file)}</span>` : "";
  const pillClass = getPriorityPillClass(fix.priority);
  return `
    <li class="fix-item">
      <div class="fix-pill ${pillClass}">${escapeHtml(fix.priority)}</div>
      <div>
        <div class="fix-title">${escapeHtml(fix.title)}</div>
        <div class="fix-meta">${file}</div>
      </div>
    </li>
  `;
}

function renderSkippedEntry(item: SkippedEntry): string {
  const hasPriority = typeof item.priority === "string" && item.priority.length > 0;
  const pill = hasPriority
    ? `<div class="fix-pill ${getPriorityPillClass(item.priority)}">${escapeHtml(item.priority)}</div>`
    : "";
  return `
    <li class="skip-item${hasPriority ? "" : " no-pill"}">
      ${pill}
      <div>
        <div class="skip-title">${escapeHtml(item.title)}</div>
        <div class="skip-reason muted">${escapeHtml(item.reason)}</div>
      </div>
    </li>
  `;
}

export function generateLogHtml(entries: LogEntry[]): string {
  const systemEntry = entries.find((entry) => entry.type === "system") as SystemEntry | undefined;
  const iterations = entries.filter((entry) => entry.type === "iteration") as IterationEntry[];
  const hasCodeSimplifier = isCodeSimplified(systemEntry);

  const header = systemEntry
    ? `
      <section class="card overview">
        <div class="card-title">Session Overview</div>
        <div class="overview-grid">
          <div>
            <div class="label">Project</div>
            <div class="value">${escapeHtml(systemEntry.projectPath)}</div>
          </div>
          <div>
            <div class="label">Branch</div>
            <div class="value">${escapeHtml(systemEntry.gitBranch ?? "no branch")}</div>
          </div>
          <div>
            <div class="label">Reviewer</div>
            <div class="value">${escapeHtml(formatAgent(systemEntry.reviewer))}</div>
          </div>
          <div>
            <div class="label">Fixer</div>
            <div class="value">${escapeHtml(formatAgent(systemEntry.fixer))}</div>
          </div>
          ${hasCodeSimplifier ? `<div><span class="status status-has-fixes">Code Simplified</span></div>` : ""}
          <div>
            <div class="label">Max Iterations</div>
            <div class="value">${systemEntry.maxIterations}</div>
          </div>
        </div>
      </section>
    `
    : "";

  const iterationBlocks =
    iterations.length === 0
      ? `<div class="empty">No log entries</div>`
      : iterations
          .map((iter) => {
            const fixes = iter.fixes?.fixes ?? [];
            const skipped = iter.fixes?.skipped ?? [];
            const error = iter.error;

            return `
              <section class="card iteration">
                <div class="iteration-header">
                  <div class="iteration-title">Iteration ${iter.iteration}</div>
                  <div class="iteration-meta">
                    <span>${formatDate(iter.timestamp)}</span>
                    <span class="dot">•</span>
                    <span>${formatDuration(iter.duration)}</span>
                  </div>
                </div>
                ${
                  error
                    ? `
                      <div class="callout error">
                        <strong>${escapeHtml(error.phase)}</strong>: ${escapeHtml(error.message)}
                      </div>
                    `
                    : ""
                }
                ${
                  fixes.length > 0
                    ? `
                      <div class="section-title">Fixes (${fixes.length})</div>
                      <ul class="fix-list">
                        ${fixes.map(renderFixEntry).join("")}
                      </ul>
                    `
                    : ""
                }
                ${
                  skipped.length > 0
                    ? `
                      <div class="section-title">Skipped (${skipped.length})</div>
                      <ul class="skip-list">
                        ${skipped.map(renderSkippedEntry).join("")}
                      </ul>
                    `
                    : ""
                }
                ${
                  fixes.length === 0 && skipped.length === 0 && !error
                    ? `<div class="muted">No issues found in this iteration.</div>`
                    : ""
                }
              </section>
            `;
          })
          .join("");

  const bodyContent =
    entries.length === 0
      ? `<div class="empty">No log entries</div>`
      : `${header}<div class="stack">${iterationBlocks}</div>`;

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Ralph Review Log</title>
        <style>${LOG_CSS}</style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="card-title">RALPH // Review Log</div>
            <div class="muted">Every iteration gets you closer to cleaner code.</div>
          </div>
          ${bodyContent}
        </div>
      </body>
    </html>
  `;
}
