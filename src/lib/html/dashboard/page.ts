import { getAgentDisplayName } from "@/lib/agents/models";
import { buildDashboardScript } from "@/lib/html/dashboard/script";
import { DASHBOARD_CSS } from "@/lib/html/dashboard/styles";
import { buildDashboardViewModel } from "@/lib/html/dashboard/view-model";
import { escapeHtml, formatNumber } from "@/lib/html/shared";
import type { DashboardData, ModelStats } from "@/lib/types";

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

function formatReasoningLevel(level: ModelStats["reasoningLevel"]): string {
  return level.toLowerCase();
}

function renderInsightsModelSection(stats: ModelStats[], role: "reviewer" | "fixer"): string {
  if (stats.length === 0) return "";

  const label = role === "reviewer" ? "Reviewer" : "Fixer";
  const tooltip = role === "reviewer" ? "Issues Found" : "Issues Fixed";
  const metricClass = role === "fixer" ? "agent-metric agent-metric-fixer" : "agent-metric";
  const sorted = [...stats].sort((a, b) => b.totalIssues - a.totalIssues);

  const items = sorted
    .map((row) => {
      const modelTitle = ` title="${escapeHtml(row.model)}"`;
      return `
        <div class="agent-row">
          <span class="agent-metric agent-metric-agent">${escapeHtml(getAgentDisplayName(row.agent))}</span>
          <div class="agent-name"${modelTitle}>${escapeHtml(row.displayName)}</div>
          <span class="agent-metric agent-metric-reasoning">${escapeHtml(formatReasoningLevel(row.reasoningLevel))}</span>
          <span class="agent-runs">
            <span class="agent-runs-count">${formatNumber(row.sessionCount)}</span>
            <span class="agent-runs-label">runs</span>
          </span>
          <span class="${metricClass}" title="${tooltip}">${formatNumber(row.totalIssues)}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="agent-section">
      <div class="agent-section-label">${label}</div>
      <div class="agent-list">${items}</div>
    </div>
  `;
}

function renderInsightsSection(
  reviewerModelStats: ModelStats[],
  fixerModelStats: ModelStats[]
): string {
  const content = [
    renderInsightsModelSection(reviewerModelStats, "reviewer"),
    renderInsightsModelSection(fixerModelStats, "fixer"),
  ].join("");

  if (!content) return "";

  return `
    <details class="insights-section">
      <summary class="insights-label">Insights</summary>
      <div id="insightsContent">${content}</div>
    </details>
  `;
}

function getInitialProjectName(data: DashboardData): string | undefined {
  if (data.currentProject && data.projects.some((p) => p.projectName === data.currentProject)) {
    return data.currentProject;
  }
  return data.projects[0]?.projectName;
}

export function generateDashboardHtml(data: DashboardData): string {
  const currentProject = getInitialProjectName(data);
  const projectStats = currentProject
    ? data.projects.find((project) => project.projectName === currentProject)
    : undefined;
  const initialSessionPath = projectStats?.sessions[0]?.sessionPath ?? null;
  const viewModel = buildDashboardViewModel(data);
  const script = buildDashboardScript({
    data,
    viewModel,
    currentProject: currentProject ?? null,
    initialSessionPath,
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Ralph Review Dashboard</title>
        <style>${DASHBOARD_CSS}</style>
      </head>
      <body>
        <div class="app">
          <aside>
            <div class="brand">
              <div class="brand-title">RALPH REVIEW</div>
              <div class="brand-sub">Dashboard</div>
            </div>
            <div class="card hero">
              <div class="hero-label">Issues Resolved</div>
              <div class="hero-number">${data.globalStats.totalFixes}</div>
              ${renderPriorityBreakdown(data.globalStats.priorityCounts)}
              ${renderInsightsSection(data.reviewerModelStats, data.fixerModelStats)}
            </div>
            <div>
              <div class="section-title">Projects</div>
              <div id="projectFilterWrapper" class="filter-wrapper">
                <input id="projectFilter" class="filter" placeholder="Filter projects..." />
                <button id="projectFilterClear" class="filter-clear" type="button">×</button>
              </div>
              <div id="projectFilterCount" class="filter-count"></div>
              <div id="projectList" class="project-list"></div>
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
                <div id="filterWrapper" class="filter-wrapper">
                  <input id="sessionFilter" class="filter" placeholder="Filter by branch, agent, p0..." />
                  <button id="filterClear" class="filter-clear" type="button">×</button>
                </div>
                <div id="filterCount" class="filter-count"></div>
                <div id="sessionList" class="session-list"></div>
              </div>
              <div class="detail-card desktop-detail" id="sessionDetail"></div>
            </div>
          </main>
        </div>
        <script>${script}</script>
      </body>
    </html>
  `;
}
