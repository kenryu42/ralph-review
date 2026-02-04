import { join } from "node:path";
import { readLog } from "@/lib/logger";
import { PRIORITY_COLORS } from "@/lib/tui/session-panel-utils";
import type {
  AgentSettings,
  DashboardData,
  FixEntry,
  IterationEntry,
  LogEntry,
  SessionStats,
  SkippedEntry,
  SystemEntry,
} from "@/lib/types";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(timestamp: number): string {
  return DATE_FORMAT.format(new Date(timestamp));
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function formatAgent(settings: AgentSettings | undefined): string {
  if (!settings) return "unknown";
  return settings.model ? `${settings.agent} (${settings.model})` : settings.agent;
}

function getPriorityPillClass(priority: string): string {
  switch (priority) {
    case "P0":
      return "fix-pill-p0";
    case "P1":
      return "fix-pill-p1";
    case "P2":
      return "fix-pill-p2";
    case "P3":
      return "fix-pill-p3";
    default:
      return "fix-pill-default";
  }
}

function getPriorityRank(priority: string): number {
  switch (priority) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
    default:
      return 99;
  }
}

function sortFixesByPriority(fixes: FixEntry[]): FixEntry[] {
  return [...fixes].sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority));
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
  const pillClass = getPriorityPillClass(item.priority);
  return `
    <li class="skip-item">
      <div class="fix-pill ${pillClass}">${escapeHtml(item.priority ?? "P?")}</div>
      <div>
        <div class="skip-title">${escapeHtml(item.title)}</div>
        <div class="skip-reason muted">${escapeHtml(item.reason)}</div>
      </div>
    </li>
  `;
}

function renderCompactSkipped(skipped: SkippedEntry[]): string {
  if (skipped.length === 0) {
    return `
      <div class="skipped-compact">
        <div class="skipped-compact-label">Skipped</div>
        <div class="muted">None</div>
      </div>
    `;
  }

  const [item] = skipped;
  return `
    <div class="skipped-compact">
      <div class="skipped-compact-label">Skipped (1)</div>
      <div class="skip-title">${escapeHtml(item?.title ?? "")}</div>
      <div class="skip-reason muted">${escapeHtml(item?.reason ?? "")}</div>
    </div>
  `;
}

function extractFixesAndSkipped(entries: LogEntry[]): {
  fixes: FixEntry[];
  skipped: SkippedEntry[];
} {
  const fixes: FixEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const entry of entries) {
    if (entry.type !== "iteration") continue;
    const iteration = entry as IterationEntry;
    if (!iteration.fixes) continue;
    fixes.push(...iteration.fixes.fixes);
    skipped.push(...iteration.fixes.skipped);
  }

  return { fixes, skipped };
}

function renderPriorityBreakdown(counts: Record<"P0" | "P1" | "P2" | "P3", number>): string {
  return `
    <div class="priority-grid">
      <div class="priority-item priority-item-p0">
        <span class="priority-label">P0</span>
        <span class="priority-value">${counts.P0}</span>
      </div>
      <div class="priority-item priority-item-p1">
        <span class="priority-label">P1</span>
        <span class="priority-value">${counts.P1}</span>
      </div>
      <div class="priority-item priority-item-p2">
        <span class="priority-label">P2</span>
        <span class="priority-value">${counts.P2}</span>
      </div>
      <div class="priority-item priority-item-p3">
        <span class="priority-label">P3</span>
        <span class="priority-value">${counts.P3}</span>
      </div>
    </div>
  `;
}

export function getHtmlPath(logPath: string): string {
  if (logPath.endsWith(".jsonl")) {
    return `${logPath.slice(0, -".jsonl".length)}.html`;
  }
  return `${logPath}.html`;
}

export function getDashboardPath(logsDir: string): string {
  return join(logsDir, "dashboard.html");
}

export function generateLogHtml(entries: LogEntry[]): string {
  const systemEntry = entries.find((entry) => entry.type === "system") as SystemEntry | undefined;
  const iterations = entries.filter((entry) => entry.type === "iteration") as IterationEntry[];

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
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap");
          :root {
            color-scheme: dark;
            --bg: #0b0f17;
            --panel: #131b2c;
            --panel-strong: #1b2842;
            --border: #25324b;
            --text: #edf2ff;
            --muted: #a0b0cc;
            --accent: #f4c34f;
            --accent-2: #f09a3e;
            --error: #ff7b7b;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: "IBM Plex Sans", "Space Grotesk", sans-serif;
            background: radial-gradient(circle at 20% 10%, rgba(126, 178, 255, 0.12), transparent 55%),
              radial-gradient(circle at 80% 0%, rgba(244, 195, 79, 0.12), transparent 60%),
              var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 48px 24px;
          }
          .container { max-width: 920px; margin: 0 auto; display: grid; gap: 24px; }
          .card {
            background: linear-gradient(135deg, rgba(244, 195, 79, 0.08), transparent 55%), var(--panel);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px 24px;
            box-shadow: 0 16px 40px rgba(3, 8, 20, 0.4);
          }
          .overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
          }
          .label { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
          .value { font-size: 15px; margin-top: 6px; }
          .card-title { font-weight: 600; font-size: 18px; margin-bottom: 16px; }
          .iteration-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
          .iteration-title { font-weight: 600; font-size: 17px; }
          .iteration-meta { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; }
          .dot { opacity: 0.6; }
          .section-title { margin: 16px 0 8px; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
          .fix-list, .skip-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
          .fix-item, .skip-item { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 12px; background: var(--panel-strong); border-radius: 12px; border: 1px solid transparent; }
          .fix-pill {
            color: #0b0f17;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            align-self: start;
          }
          .fix-pill-p0 { background: ${PRIORITY_COLORS.P0}; }
          .fix-pill-p1 { background: ${PRIORITY_COLORS.P1}; }
          .fix-pill-p2 { background: ${PRIORITY_COLORS.P2}; }
          .fix-pill-p3 { background: ${PRIORITY_COLORS.P3}; }
          .fix-pill-default { background: var(--accent); }
          .fix-title { font-weight: 600; }
          .fix-meta { font-size: 12px; margin-top: 4px; }
          .skip-title { font-weight: 600; }
          .skip-reason { font-size: 12px; }
          .muted { color: var(--muted); }
          .callout {
            margin-top: 12px;
            padding: 12px 16px;
            border-radius: 12px;
            background: rgba(255, 123, 123, 0.12);
            border: 1px solid rgba(255, 123, 123, 0.4);
          }
          .callout.error strong { color: var(--error); }
          .empty {
            padding: 32px;
            text-align: center;
            color: var(--muted);
            border: 1px dashed var(--border);
            border-radius: 16px;
            background: rgba(13, 20, 35, 0.6);
          }
          .stack { display: grid; gap: 18px; }
        </style>
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

export async function writeLogHtml(logPath: string): Promise<void> {
  const entries = await readLog(logPath);
  const html = generateLogHtml(entries);
  await Bun.write(getHtmlPath(logPath), html);
}

function getInitialProjectName(data: DashboardData): string | undefined {
  if (data.currentProject && data.projects.some((p) => p.projectName === data.currentProject)) {
    return data.currentProject;
  }
  return data.projects[0]?.projectName;
}

function renderProjectList(data: DashboardData, currentProject: string | undefined): string {
  if (data.projects.length === 0) {
    return `<div class="empty tiny">No projects yet. Run <span class="mono">rr run</span> to start.</div>`;
  }

  return data.projects
    .map((project) => {
      const selected = project.projectName === currentProject;
      return `
        <button class="project-item ${selected ? "active" : ""}" data-project="${
          project.projectName
        }">
          <div class="project-title">${escapeHtml(project.displayName)}</div>
          <div class="project-meta">
            <span>${project.totalFixes} fixes</span>
            <span>${project.sessionCount} sessions</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderSessionList(sessions: SessionStats[]): string {
  if (sessions.length === 0) {
    return `<div class="empty tiny">No sessions for this project yet.</div>`;
  }

  return sessions
    .map((session, index) => {
      const branch = session.gitBranch ?? "no branch";
      return `
        <button class="session-card ${index === 0 ? "active" : ""}" data-session="${
          session.sessionPath
        }">
          <div class="session-row">
            <div>
              <div class="session-title">${escapeHtml(branch)}</div>
              <div class="session-meta">${formatDate(session.timestamp)}</div>
            </div>
            <div class="status status-${session.status}">${session.status}</div>
          </div>
          <div class="session-stats">
            <span>${session.totalFixes} fixes</span>
            <span>${session.iterations} iterations</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderSessionDetail(session: SessionStats | undefined): string {
  if (!session) {
    return `<div class="empty">Select a session to see the full story.</div>`;
  }

  const { fixes: rawFixes, skipped } = extractFixesAndSkipped(session.entries);
  const fixes = sortFixesByPriority(rawFixes);
  const branch = session.gitBranch ?? "no branch";
  const totalDuration = formatDuration(session.totalDuration);
  const showSkippedPanel = skipped.length > 1;

  return `
    <div class="detail-header">
      <div>
        <div class="detail-title">${escapeHtml(branch)}</div>
        <div class="detail-meta">
          ${formatDate(session.timestamp)}
          <span class="dot">•</span>
          ${totalDuration}
          <span class="dot">•</span>
          <span class="status status-${session.status}">${session.status}</span>
        </div>
      </div>
      <div class="detail-stats">
        <div class="stat">
          <div class="stat-label">Fixes</div>
          <div class="stat-value">${session.totalFixes}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Skipped</div>
          <div class="stat-value">${session.totalSkipped}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Iterations</div>
          <div class="stat-value">${session.iterations}</div>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="panel">
        <div class="panel-title">Fixes Applied</div>
        ${
          fixes.length > 0
            ? `<ul class="fix-list">${fixes.map(renderFixEntry).join("")}</ul>`
            : `<div class="muted">No fixes recorded for this session.</div>`
        }
      </div>
      ${
        showSkippedPanel
          ? `<div class="panel">
              <div class="panel-title">Skipped</div>
              <ul class="skip-list">${skipped.map(renderSkippedEntry).join("")}</ul>
            </div>`
          : ""
      }
    </div>
    ${showSkippedPanel ? "" : renderCompactSkipped(skipped)}
  `;
}

export function generateDashboardHtml(data: DashboardData): string {
  const currentProject = getInitialProjectName(data);
  const projectStats = currentProject
    ? data.projects.find((project) => project.projectName === currentProject)
    : undefined;
  const sessions = projectStats?.sessions ?? [];
  const initialSession = sessions[0];

  const totalFixes = data.globalStats.totalFixes;
  const highImpact = data.globalStats.priorityCounts.P0 + data.globalStats.priorityCounts.P1;

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Ralph Review Dashboard</title>
        <style>
          @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap");
          :root {
            color-scheme: dark;
            --bg: #0b0f17;
            --bg-2: #101827;
            --panel: #131b2c;
            --panel-2: #19243b;
            --panel-3: #1f2c47;
            --border: #25324b;
            --text: #edf2ff;
            --muted: #9fb1cc;
            --accent: #f4c34f;
            --accent-2: #f09a3e;
            --accent-3: #7eb2ff;
            --success: #45d49f;
            --warning: #f4c34f;
            --danger: #ff7b7b;
            --shadow: rgba(3, 8, 20, 0.5);
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: "IBM Plex Sans", sans-serif;
            color: var(--text);
            background:
              radial-gradient(circle at 12% 12%, rgba(126, 178, 255, 0.12), transparent 45%),
              radial-gradient(circle at 85% 5%, rgba(244, 195, 79, 0.12), transparent 55%),
              linear-gradient(135deg, #0b0f17 0%, #101827 45%, #0b1420 100%);
          }
          body::before {
            content: "";
            position: fixed;
            inset: 0;
            background-image:
              linear-gradient(transparent 95%, rgba(255, 255, 255, 0.02) 95%),
              linear-gradient(90deg, transparent 95%, rgba(255, 255, 255, 0.02) 95%);
            background-size: 24px 24px;
            pointer-events: none;
            opacity: 0.4;
          }
          .app {
            display: grid;
            grid-template-columns: 320px 1fr;
            min-height: 100vh;
            position: relative;
            z-index: 1;
          }
          aside {
            padding: 32px 24px;
            border-right: 1px solid var(--border);
            background: rgba(9, 14, 23, 0.85);
            backdrop-filter: blur(12px);
            display: flex;
            flex-direction: column;
            gap: 24px;
          }
          main { padding: 32px 36px; display: flex; flex-direction: column; gap: 24px; }
          .brand { display: grid; gap: 6px; }
          .brand-title {
            font-family: "Space Grotesk", sans-serif;
            font-weight: 700;
            font-size: 22px;
            letter-spacing: 0.08em;
          }
          .brand-sub { color: var(--muted); font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; }
          .card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 20px;
            box-shadow: 0 16px 40px var(--shadow);
          }
          .hero {
            display: grid;
            gap: 14px;
            background:
              linear-gradient(135deg, rgba(244, 195, 79, 0.18), transparent 55%),
              linear-gradient(135deg, rgba(126, 178, 255, 0.12), transparent 60%),
              var(--panel);
          }
          .hero-number {
            font-family: "Space Grotesk", sans-serif;
            font-size: 48px;
            font-weight: 700;
            letter-spacing: -0.02em;
            color: var(--accent);
          }
          .hero-label { font-size: 13px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--muted); }
          .hero-sub { font-size: 15px; color: var(--text); }
          .hero-glow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 999px;
            background: rgba(244, 195, 79, 0.18);
            border: 1px solid rgba(244, 195, 79, 0.4);
            color: var(--accent);
            font-weight: 600;
            font-size: 12px;
          }
          .priority-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
          }
          .priority-item {
            background: var(--panel-2);
            border: 1px solid transparent;
            border-radius: 12px;
            padding: 8px;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .priority-label {
            display: block;
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
          }
          .priority-value {
            display: block;
            font-size: 18px;
            font-weight: 600;
            margin-top: 4px;
            line-height: 1;
          }
          .priority-item-p0 .priority-label { color: ${PRIORITY_COLORS.P0}; }
          .priority-item-p1 .priority-label { color: ${PRIORITY_COLORS.P1}; }
          .priority-item-p2 .priority-label { color: ${PRIORITY_COLORS.P2}; }
          .priority-item-p3 .priority-label { color: ${PRIORITY_COLORS.P3}; }
          .section-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
          .project-list, .session-list { display: grid; gap: 10px; }
          .project-item, .session-card {
            background: var(--panel);
            border: 1px solid transparent;
            border-radius: 14px;
            padding: 14px 16px;
            color: inherit;
            text-align: left;
            cursor: pointer;
            transition: border-color 120ms ease, transform 120ms ease;
          }
          .project-item:hover, .session-card:hover { border-color: rgba(126, 178, 255, 0.4); transform: translateY(-1px); }
          .project-item.active:hover { transform: none; }
          .session-card.active:hover { transform: none; }
          .project-item.active, .session-card.active {
            border-color: rgba(244, 195, 79, 0.6);
            box-shadow: 0 0 0 1px rgba(244, 195, 79, 0.2);
          }
          .project-title { font-weight: 600; font-size: 15px; }
          .project-meta { display: flex; gap: 12px; color: var(--muted); font-size: 12px; margin-top: 6px; }
          .topbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }
          .topbar h1 {
            font-family: "Space Grotesk", sans-serif;
            font-size: 26px;
            margin: 0;
          }
          .topbar .sub {
            color: var(--muted);
            font-size: 14px;
            margin-top: 4px;
          }
          .summary-row { display: flex; gap: 16px; flex-wrap: wrap; }
          .summary-card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 14px 16px;
            min-width: 160px;
          }
          .summary-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
          .summary-value { font-size: 20px; font-weight: 600; margin-top: 6px; }
          .content-grid {
            display: grid;
            grid-template-columns: 320px 1fr;
            gap: 24px;
          }
          .session-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
          .session-title { font-weight: 600; font-size: 15px; }
          .session-meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
          .session-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
          .session-stats { display: flex; gap: 12px; color: var(--muted); font-size: 12px; margin-top: 8px; }
          .status {
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .status-completed { background: rgba(69, 212, 159, 0.18); color: var(--success); }
          .status-running { background: rgba(126, 178, 255, 0.18); color: var(--accent-3); }
          .status-failed { background: rgba(255, 123, 123, 0.18); color: var(--danger); }
          .status-interrupted { background: rgba(244, 195, 79, 0.18); color: var(--warning); }
          .status-unknown { background: rgba(159, 177, 204, 0.18); color: var(--muted); }
          .detail-card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 20px;
            min-height: 320px;
          }
          .session-inline-detail {
            display: none;
            min-height: 0;
          }
          .detail-header { display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 16px; }
          .detail-title { font-family: "Space Grotesk", sans-serif; font-size: 20px; font-weight: 600; }
          .detail-meta { color: var(--muted); font-size: 13px; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
          .detail-stats { display: flex; gap: 12px; }
          .stat { background: var(--panel-2); border-radius: 12px; padding: 10px 12px; min-width: 90px; text-align: center; }
          .stat-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
          .stat-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
          .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
          .panel { background: var(--panel-2); border-radius: 14px; padding: 14px; border: 1px solid transparent; }
          .panel-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted); margin-bottom: 10px; }
          .skipped-compact {
            margin-top: 12px;
            background: var(--panel-2);
            border-radius: 14px;
            padding: 12px 14px;
            border: 1px solid transparent;
          }
          .skipped-compact-label {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--muted);
            margin-bottom: 6px;
          }
          .fix-list, .skip-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
          .fix-item, .skip-item { display: grid; grid-template-columns: auto 1fr; gap: 10px; background: var(--panel-3); border-radius: 10px; padding: 10px; }
          .fix-pill {
            color: #0b0f17;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 11px;
            align-self: start;
          }
          .fix-pill-p0 { background: ${PRIORITY_COLORS.P0}; }
          .fix-pill-p1 { background: ${PRIORITY_COLORS.P1}; }
          .fix-pill-p2 { background: ${PRIORITY_COLORS.P2}; }
          .fix-pill-p3 { background: ${PRIORITY_COLORS.P3}; }
          .fix-pill-default { background: var(--accent); }
          .fix-title, .skip-title { font-weight: 600; font-size: 13px; }
          .fix-meta, .skip-reason { font-size: 11px; margin-top: 4px; }
          .muted { color: var(--muted); }
          .empty { padding: 24px; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: 16px; background: rgba(9, 14, 23, 0.6); }
          .empty.tiny { padding: 12px; font-size: 12px; }
          .filter {
            margin-top: 10px;
            margin-bottom: 10px;
            background: var(--panel-2);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 8px 12px;
            color: var(--text);
            font-size: 13px;
            width: 100%;
          }
          .mono { font-family: "Space Grotesk", monospace; }
          @media (max-width: 1100px) {
            .app { grid-template-columns: 1fr; }
            aside { border-right: none; border-bottom: 1px solid var(--border); }
            .content-grid { grid-template-columns: 1fr; }
            .desktop-detail { display: none; }
            .session-inline-detail { display: block; }
          }
        </style>
      </head>
      <body>
        <div class="app">
          <aside>
            <div class="brand">
              <div class="brand-title">RALPH REVIEW</div>
              <div class="brand-sub">Code Review Dashboard</div>
            </div>
            <div class="card hero">
              <div class="hero-label">Issues Resolved</div>
              <div class="hero-number">${totalFixes}</div>
              <div class="hero-sub">Each fix is a bug that never ships.</div>
              <div class="hero-glow">${highImpact} high-impact fixes delivered</div>
              ${renderPriorityBreakdown(data.globalStats.priorityCounts)}
            </div>
            <div>
              <div class="section-title">Projects</div>
              <div id="projectList" class="project-list">
                ${renderProjectList(data, currentProject)}
              </div>
            </div>
          </aside>
          <main>
            <div class="topbar">
              <div>
                <h1 id="projectTitle">${escapeHtml(projectStats?.displayName ?? "No project yet")}</h1>
              </div>
              <div class="summary-row">
                <div class="summary-card">
                  <div class="summary-label">Total Sessions</div>
                  <div class="summary-value" id="totalSessions">${data.globalStats.totalSessions}</div>
                </div>
              </div>
            </div>
            <div class="content-grid">
              <div>
                <div class="session-header">
                  <div class="section-title">Sessions</div>
                </div>
                <input id="sessionFilter" class="filter" placeholder="Filter by branch or status" />
                <div id="sessionList" class="session-list">
                  ${renderSessionList(sessions)}
                </div>
              </div>
              <div class="detail-card desktop-detail" id="sessionDetail">
                ${renderSessionDetail(initialSession)}
              </div>
            </div>
          </main>
        </div>
        <script>
          const dashboardData = ${serializeForScript(data)};
          const state = {
            projectName: ${serializeForScript(currentProject ?? null)},
            sessionPath: ${serializeForScript(initialSession?.sessionPath ?? null)},
            filter: ""
          };

          const numberFormat = new Intl.NumberFormat();

          const projectList = document.getElementById("projectList");
          const sessionList = document.getElementById("sessionList");
          const sessionDetail = document.getElementById("sessionDetail");
          const sessionFilter = document.getElementById("sessionFilter");
          const projectTitle = document.getElementById("projectTitle");

          const formatDate = (timestamp) => new Date(timestamp).toLocaleString();
          const isMobileView = () => window.matchMedia("(max-width: 1100px)").matches;

          const formatDuration = (ms) => {
            if (ms === undefined || ms === null) return "—";
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            if (hours > 0) return \`\${hours}h \${minutes}m \${seconds}s\`;
            if (minutes > 0) return \`\${minutes}m \${seconds}s\`;
            return \`\${seconds}s\`;
          };

          const escapeHtml = (value) =>
            String(value)
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;");

          const getPriorityPillClass = (priority) => {
            switch (priority) {
              case "P0":
                return "fix-pill-p0";
              case "P1":
                return "fix-pill-p1";
              case "P2":
                return "fix-pill-p2";
              case "P3":
                return "fix-pill-p3";
              default:
                return "fix-pill-default";
            }
          };

          const getPriorityRank = (priority) => {
            switch (priority) {
              case "P0":
                return 0;
              case "P1":
                return 1;
              case "P2":
                return 2;
              case "P3":
                return 3;
              default:
                return 99;
            }
          };

          const sortFixesByPriority = (fixes) =>
            [...fixes].sort((a, b) => getPriorityRank(a.priority) - getPriorityRank(b.priority));

          const extractFixes = (entries) => {
            const fixes = [];
            const skipped = [];
            for (const entry of entries || []) {
              if (entry.type !== "iteration" || !entry.fixes) continue;
              fixes.push(...entry.fixes.fixes);
              skipped.push(...entry.fixes.skipped);
            }
            return { fixes, skipped };
          };

          const getProject = (name) =>
            dashboardData.projects.find((project) => project.projectName === name);

          const getSelectedSession = () => {
            const project = getProject(state.projectName);
            return project?.sessions.find((session) => session.sessionPath === state.sessionPath);
          };

          const buildSessionDetailHtml = (session) => {
            if (!session) {
              return '<div class="empty">Select a session to see the full story.</div>';
            }

            const branch = session.gitBranch || "no branch";
            const { fixes: rawFixes, skipped } = extractFixes(session.entries || []);
            const fixes = sortFixesByPriority(rawFixes);
            const showSkippedPanel = skipped.length > 1;

            return \`
              <div class="detail-header">
                <div>
                  <div class="detail-title">\${escapeHtml(branch)}</div>
                  <div class="detail-meta">
                    \${formatDate(session.timestamp)}
                    <span class="dot">•</span>
                    \${formatDuration(session.totalDuration)}
                    <span class="dot">•</span>
                    <span class="status status-\${session.status}">\${session.status}</span>
                  </div>
                </div>
                <div class="detail-stats">
                  <div class="stat">
                    <div class="stat-label">Fixes</div>
                    <div class="stat-value">\${numberFormat.format(session.totalFixes)}</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Skipped</div>
                    <div class="stat-value">\${numberFormat.format(session.totalSkipped)}</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Iterations</div>
                    <div class="stat-value">\${numberFormat.format(session.iterations)}</div>
                  </div>
                </div>
              </div>
              <div class="detail-grid">
                <div class="panel">
                  <div class="panel-title">Fixes Applied</div>
                  \${fixes.length
                    ? \`<ul class="fix-list">\${fixes
                        .map((fix) => \`
                          <li class="fix-item">
                            <div class="fix-pill \${getPriorityPillClass(fix.priority)}">\${escapeHtml(fix.priority)}</div>
                            <div>
                              <div class="fix-title">\${escapeHtml(fix.title)}</div>
                              <div class="fix-meta muted">\${escapeHtml(fix.file || "")}</div>
                            </div>
                          </li>
                        \`)
                        .join("")}</ul>\`
                    : '<div class="muted">No fixes recorded for this session.</div>'}
                </div>
                \${showSkippedPanel
                  ? \`<div class="panel">
                      <div class="panel-title">Skipped</div>
                      <ul class="skip-list">\${skipped
                        .map((item) => \`
                          <li class="skip-item">
                            <div>
                              <div class="skip-title">\${escapeHtml(item.title)}</div>
                              <div class="skip-reason muted">\${escapeHtml(item.reason)}</div>
                            </div>
                          </li>
                        \`)
                        .join("")}</ul>
                    </div>\`
                  : ""}
              </div>
              \${showSkippedPanel
                ? ""
                : skipped.length
                  ? \`<div class="skipped-compact">
                      <div class="skipped-compact-label">Skipped (1)</div>
                      <div class="skip-title">\${escapeHtml(skipped[0]?.title || "")}</div>
                      <div class="skip-reason muted">\${escapeHtml(skipped[0]?.reason || "")}</div>
                    </div>\`
                  : \`<div class="skipped-compact">
                      <div class="skipped-compact-label">Skipped</div>
                      <div class="muted">None</div>
                    </div>\`}
            \`;
          };

          const renderProjects = () => {
            if (!projectList) return;
            projectList.innerHTML = "";
            if (dashboardData.projects.length === 0) {
              projectList.innerHTML =
                '<div class="empty tiny">No projects yet. Run <span class="mono">rr run</span> to start.</div>';
              return;
            }
            for (const project of dashboardData.projects) {
              const btn = document.createElement("button");
              btn.className = "project-item" + (project.projectName === state.projectName ? " active" : "");
              btn.dataset.project = project.projectName;
              btn.innerHTML = \`
                <div class="project-title">\${escapeHtml(project.displayName)}</div>
                <div class="project-meta">
                  <span>\${numberFormat.format(project.totalFixes)} fixes</span>
                  <span>\${numberFormat.format(project.sessionCount)} sessions</span>
                </div>
              \`;
              btn.addEventListener("click", () => {
                state.projectName = project.projectName;
                state.sessionPath = null;
                render();
              });
              projectList.appendChild(btn);
            }
          };

          const renderSessions = () => {
            if (!sessionList) return;
            sessionList.innerHTML = "";
            const project = getProject(state.projectName);
            if (!project || project.sessions.length === 0) {
              sessionList.innerHTML = '<div class="empty tiny">No sessions for this project yet.</div>';
              return;
            }

            const filter = (state.filter || "").toLowerCase().trim();
            const sessions = project.sessions.filter((session) => {
              if (!filter) return true;
              const haystack = [session.gitBranch, session.status, session.sessionName]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return haystack.includes(filter);
            });

            if (!sessions.length) {
              sessionList.innerHTML = '<div class="empty tiny">No sessions match that filter.</div>';
              return;
            }

            if (!state.sessionPath) {
              state.sessionPath = sessions[0].sessionPath;
            }
            if (!sessions.some((session) => session.sessionPath === state.sessionPath)) {
              state.sessionPath = sessions[0].sessionPath;
            }

            const mobileView = isMobileView();

            sessions.forEach((session) => {
              const isSelected = session.sessionPath === state.sessionPath;
              const btn = document.createElement("button");
              btn.className = "session-card" + (isSelected ? " active" : "");
              btn.dataset.session = session.sessionPath;
              btn.innerHTML = \`
                <div class="session-row">
                  <div>
                    <div class="session-title">\${escapeHtml(session.gitBranch || "no branch")}</div>
                    <div class="session-meta">\${formatDate(session.timestamp)}</div>
                  </div>
                  <div class="status status-\${session.status}">\${session.status}</div>
                </div>
                <div class="session-stats">
                  <span>\${numberFormat.format(session.totalFixes)} fixes</span>
                  <span>\${numberFormat.format(session.iterations)} iterations</span>
                </div>
              \`;
              btn.addEventListener("click", () => {
                state.sessionPath = session.sessionPath;
                render();
              });
              sessionList.appendChild(btn);

              if (mobileView && isSelected) {
                const inlineDetail = document.createElement("div");
                inlineDetail.className = "detail-card session-inline-detail";
                inlineDetail.innerHTML = buildSessionDetailHtml(session);
                sessionList.appendChild(inlineDetail);
              }
            });
          };

          const renderDetails = () => {
            if (!sessionDetail) return;
            sessionDetail.innerHTML = buildSessionDetailHtml(getSelectedSession());
          };

          const renderHeader = () => {
            const project = getProject(state.projectName);
            if (projectTitle) {
              projectTitle.textContent = project?.displayName || "No project yet";
            }
          };

          const render = () => {
            renderProjects();
            renderHeader();
            renderSessions();
            renderDetails();
          };

          if (sessionFilter) {
            sessionFilter.addEventListener("input", (event) => {
              state.filter = event.target.value || "";
              render();
            });
          }

          window.addEventListener("resize", render);

          render();
        </script>
      </body>
    </html>
  `;
}

export async function writeDashboardHtml(
  dashboardPath: string,
  data: DashboardData
): Promise<void> {
  const html = generateDashboardHtml(data);
  await Bun.write(dashboardPath, html);
}
