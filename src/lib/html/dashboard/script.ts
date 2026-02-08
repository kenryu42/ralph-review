import type { DashboardViewModel } from "@/lib/html/dashboard/view-model";
import { serializeForScript } from "@/lib/html/shared";
import type { DashboardData } from "@/lib/types";

interface ScriptArgs {
  data: DashboardData;
  viewModel: DashboardViewModel;
  currentProject: string | null;
  initialSessionPath: string | null;
}

const DATA_TOKEN = "__DASHBOARD_DATA__";
const VIEW_MODEL_TOKEN = "__DASHBOARD_VIEW_MODEL__";
const PROJECT_TOKEN = "__STATE_PROJECT_NAME__";
const SESSION_TOKEN = "__STATE_SESSION_PATH__";

const DASHBOARD_SCRIPT_TEMPLATE = `
  const dashboardData = __DASHBOARD_DATA__;
  const dashboardViewModel = __DASHBOARD_VIEW_MODEL__;
  const state = {
    projectName: __STATE_PROJECT_NAME__,
    sessionPath: __STATE_SESSION_PATH__,
    filter: "",
    projectFilter: ""
  };

  const numberFormat = new Intl.NumberFormat();

  const debounce = (fn, ms) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  };

  const formatFixesLabel = (totalFixes) => {
    if (totalFixes === 0) return "No Issues";
    const count = numberFormat.format(totalFixes);
    return count + " fixes";
  };

  const getFixesLabelClass = (totalFixes) =>
    totalFixes === 0 ? "status-no-issues" : "status-has-fixes";

  const getSessionViewModel = (session) => {
    if (!dashboardViewModel || !dashboardViewModel.sessionsByPath) return null;
    return dashboardViewModel.sessionsByPath[session.sessionPath] || null;
  };

  const getSessionBadge = (session) => {
    const vm = getSessionViewModel(session);
    if (vm?.badge) return vm.badge;

    // Non-completed statuses take precedence
    if (session.status !== "completed") {
      return {
        label: session.status,
        className: \`status-\${session.status}\`,
      };
    }

    // Completed with skipped items but no fixes - show skipped count
    if (session.totalFixes === 0 && session.totalSkipped > 0) {
      return {
        label: \`\${numberFormat.format(session.totalSkipped)} skipped\`,
        className: "status-has-skipped",
      };
    }

    // Completed with fixes
    if (session.totalFixes > 0) {
      return {
        label: formatFixesLabel(session.totalFixes),
        className: "status-has-fixes",
      };
    }

    // Truly clean: completed, no fixes, no skipped
    return {
      label: "No Issues",
      className: "status-no-issues",
    };
  };

  const projectList = document.getElementById("projectList");
  const projectFilterEl = document.getElementById("projectFilter");
  const projectFilterWrapper = document.getElementById("projectFilterWrapper");
  const projectFilterClear = document.getElementById("projectFilterClear");
  const projectFilterCount = document.getElementById("projectFilterCount");
  const sessionList = document.getElementById("sessionList");
  const sessionDetail = document.getElementById("sessionDetail");
  const sessionFilter = document.getElementById("sessionFilter");
  const filterWrapper = document.getElementById("filterWrapper");
  const filterClear = document.getElementById("filterClear");
  const filterCount = document.getElementById("filterCount");
  const projectTitle = document.getElementById("projectTitle");

  const formatDate = (timestamp) => new Date(timestamp).toLocaleString();
  const isMobileView = () => window.matchMedia("(max-width: 1280px)").matches;

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

  const formatRoleDisplay = (name, model, reasoning) => {
    const details = [model, reasoning].filter(Boolean);
    if (details.length === 0) return name;
    return \`\${name} (\${details.join(", ")})\`;
  };

  const getSessionSystemEntry = (session) =>
    session.entries?.find((entry) => entry.type === "system");

  const isCodeSimplified = (systemEntry) =>
    Boolean(systemEntry?.codeSimplifier || systemEntry?.reviewOptions?.simplifier);

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

  const sortByPriority = (fixes) =>
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

  const getSessionPriorities = (session) => {
    const vm = getSessionViewModel(session);
    if (vm?.prioritiesText) return vm.prioritiesText;

    const { fixes } = extractFixes(session.entries || []);
    const priorities = new Set(fixes.map((fix) => fix.priority));
    return Array.from(priorities).join(" ");
  };

  const getProject = (name) =>
    dashboardData.projects.find((project) => project.projectName === name);

  const buildInsightsModelSection = (stats, role) => {
    if (!stats || stats.length === 0) return "";
    const label = role === "reviewer" ? "Reviewer" : "Fixer";
    const tooltip = role === "reviewer" ? "Issues Found" : "Issues Fixed";
    const metricClass = role === "fixer" ? "agent-metric agent-metric-fixer" : "agent-metric";
    const sorted = [...stats].sort((a, b) => b.totalIssues - a.totalIssues);
    const items = sorted.map((row) => \`
      <div class="agent-row">
        <span class="agent-metric agent-metric-agent">\${escapeHtml(row.agentDisplayName || row.agent)}</span>
        <div class="agent-name" title="\${escapeHtml(row.model)}">\${escapeHtml(row.displayName)}</div>
        <span class="agent-metric agent-metric-reasoning">\${escapeHtml((row.reasoningLevel || "").toLowerCase())}</span>
        <span class="agent-runs">
          <span class="agent-runs-count">\${numberFormat.format(row.sessionCount)}</span>
          <span class="agent-runs-label">runs</span>
        </span>
        <span class="\${metricClass}" title="\${tooltip}">\${numberFormat.format(row.totalIssues)}</span>
      </div>
    \`).join("");
    return \`
      <div class="agent-section">
        <div class="agent-section-label">\${label}</div>
        <div class="agent-list">\${items}</div>
      </div>
    \`;
  };

  const buildInsightsContent = (reviewerModelStats, fixerModelStats) => {
    return [
      buildInsightsModelSection(reviewerModelStats, "reviewer"),
      buildInsightsModelSection(fixerModelStats, "fixer"),
    ].join("");
  };

  const getSelectedSession = () => {
    const project = getProject(state.projectName);
    return project?.sessions.find((session) => session.sessionPath === state.sessionPath);
  };

  const buildSessionDetailHtml = (session) => {
    if (!session) {
      return '<div class="empty">Select a session to see the full story.</div>';
    }

    const branch = session.gitBranch || "no branch";
    const vm = getSessionViewModel(session);
    const { fixes: rawFixes, skipped: rawSkipped } = extractFixes(session.entries || []);
    const fixes = vm?.sortedFixes ?? sortByPriority(rawFixes);
    const skipped = vm?.sortedSkipped ?? sortByPriority(rawSkipped);
    const encodedSessionPath = encodeURIComponent(session.sessionPath);
    const showSkippedPanel = skipped.length > 1;
    const reviewerName = session.reviewerDisplayName || session.reviewer || "unknown";
    const reviewerModel = session.reviewerModelDisplayName || session.reviewerModel || "";
    const reviewerReasoning = session.reviewerReasoning || "";
    const fixerName = session.fixerDisplayName || session.fixer || "unknown";
    const fixerModel = session.fixerModelDisplayName || session.fixerModel || "";
    const fixerReasoning = session.fixerReasoning || "";
    const reviewerDisplay =
      vm?.reviewerDisplay ?? formatRoleDisplay(reviewerName, reviewerModel, reviewerReasoning);
    const fixerDisplay = vm?.fixerDisplay ?? formatRoleDisplay(fixerName, fixerModel, fixerReasoning);
    const systemEntry = getSessionSystemEntry(session);
    const hasCodeSimplifier = vm?.codeSimplified ?? isCodeSimplified(systemEntry);

    return \`
      <div class="detail-toolbar">
        <div class="section-title" style="margin-bottom: 0; opacity: 0.8;">Session Details</div>
        <button
          class="icon-btn delete delete-btn"
          title="Delete Session Log"
          data-session-path="\${escapeHtml(encodedSessionPath)}"
          onclick="deleteSession(decodeURIComponent(this.dataset.sessionPath))"
        >
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
        </button>
      </div>
      <div class="detail-header">
        <div style="flex: 1; min-width: 0;">
          <div class="detail-title" style="margin-bottom: 14px;">\${escapeHtml(branch)}</div>
          <div class="detail-summary">
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
              \${hasCodeSimplifier
                ? \`<div class="stat stat-code-simplified"><div class="stat-value"><span>CODE</span><span>SIMPLIFIED</span></div></div>\`
                : ""}
            </div>
            <div class="detail-meta-block">
              <div class="detail-meta"><span class="detail-meta-label">Duration:</span> \${formatDuration(session.totalDuration)}</div>
              <div class="detail-meta"><span class="detail-meta-label">Reviewer:</span> \${escapeHtml(reviewerDisplay)}</div>
              <div class="detail-meta"><span class="detail-meta-label">Fixer:</span> \${escapeHtml(fixerDisplay)}</div>
            </div>
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
                  <li class="skip-item\${item.priority ? "" : " no-pill"}">
                    \${item.priority
                      ? \`<div class="fix-pill \${getPriorityPillClass(item.priority)}">\${escapeHtml(item.priority)}</div>\`
                      : ""}
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
              <div class="skip-item\${skipped[0]?.priority ? "" : " no-pill"}">
                \${skipped[0]?.priority
                  ? \`<div class="fix-pill \${getPriorityPillClass(skipped[0].priority)}">\${escapeHtml(skipped[0].priority)}</div>\`
                  : ""}
                <div>
                  <div class="skip-title">\${escapeHtml(skipped[0]?.title || "")}</div>
                  <div class="skip-reason muted">\${escapeHtml(skipped[0]?.reason || "")}</div>
                </div>
              </div>
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
    const totalCount = dashboardData.projects.length;
    if (totalCount === 0) {
      projectList.innerHTML =
        '<div class="empty tiny">No projects yet. Run <span class="mono">rr run</span> to start.</div>';
      if (projectFilterCount) projectFilterCount.textContent = "";
      return;
    }

    const filter = (state.projectFilter || "").toLowerCase().trim();
    const projects = dashboardData.projects.filter((project) => {
      if (!filter) return true;
      const haystack = [project.projectName, project.displayName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(filter);
    });

    if (projectFilterCount) {
      if (filter) {
        projectFilterCount.textContent = \`\${projects.length} of \${totalCount} projects\`;
      } else {
        projectFilterCount.textContent = \`\${totalCount} projects\`;
      }
    }

    if (!projects.length) {
      projectList.innerHTML = '<div class="empty tiny">No projects match that filter.</div>';
      return;
    }

    for (const project of projects) {
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
    const totalCount = project.sessions.length;
    const sessions = project.sessions.filter((session) => {
      if (!filter) return true;
      const haystack = [
        session.gitBranch,
        session.status,
        session.sessionName,
        session.reviewer,
        session.fixer,
        session.reviewerDisplayName,
        session.fixerDisplayName,
        getSessionPriorities(session)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(filter);
    });

    if (filterCount) {
      if (filter) {
        filterCount.textContent = \`\${sessions.length} of \${totalCount} sessions\`;
      } else {
        filterCount.textContent = \`\${totalCount} sessions\`;
      }
    }

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
      const badge = getSessionBadge(session);
      btn.innerHTML = \`
        <div class="session-row">
          <div>
            <div class="session-title">\${escapeHtml(session.gitBranch || "no branch")}</div>
            <div class="session-meta">\${formatDate(session.timestamp)}</div>
          </div>
          <div class="status \${badge.className}">\${badge.label}</div>
        </div>
        <div class="session-stats">
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

  const updateFilter = (value) => {
    state.filter = value;
    if (filterWrapper) {
      filterWrapper.classList.toggle("has-value", value.length > 0);
    }
    render();
  };

  const debouncedUpdate = debounce((value) => updateFilter(value), 150);

  if (sessionFilter) {
    sessionFilter.addEventListener("input", (event) => {
      const value = event.target.value || "";
      if (filterWrapper) {
        filterWrapper.classList.toggle("has-value", value.length > 0);
      }
      debouncedUpdate(value);
    });
  }

  if (filterClear) {
    filterClear.addEventListener("click", () => {
      if (sessionFilter) {
        sessionFilter.value = "";
        sessionFilter.focus();
      }
      updateFilter("");
    });
  }

  const updateProjectFilter = (value) => {
    state.projectFilter = value;
    if (projectFilterWrapper) {
      projectFilterWrapper.classList.toggle("has-value", value.length > 0);
    }
    render();
  };

  const debouncedProjectUpdate = debounce((value) => updateProjectFilter(value), 150);

  if (projectFilterEl) {
    projectFilterEl.addEventListener("input", (event) => {
      const value = event.target.value || "";
      if (projectFilterWrapper) {
        projectFilterWrapper.classList.toggle("has-value", value.length > 0);
      }
      debouncedProjectUpdate(value);
    });
  }

  if (projectFilterClear) {
    projectFilterClear.addEventListener("click", () => {
      if (projectFilterEl) {
        projectFilterEl.value = "";
        projectFilterEl.focus();
      }
      updateProjectFilter("");
    });
  }

  const deleteSession = async (sessionPath) => {
    if (!confirm("Delete this session log? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionPath }),
      });
      if (!res.ok) {
        const text = await res.text();
        alert("Failed to delete session: " + text);
        return;
      }
      const updated = await res.json();
      dashboardData.globalStats = updated.globalStats;
      dashboardData.projects = updated.projects;
      dashboardData.reviewerAgentStats = updated.reviewerAgentStats;
      dashboardData.fixerAgentStats = updated.fixerAgentStats;
      dashboardData.reviewerModelStats = updated.reviewerModelStats;
      dashboardData.fixerModelStats = updated.fixerModelStats;
      state.sessionPath = null;
      if (dashboardViewModel?.sessionsByPath) {
        delete dashboardViewModel.sessionsByPath[sessionPath];
      }

      // If current project no longer exists, select first available or clear
      if (state.projectName && !getProject(state.projectName)) {
        state.projectName = dashboardData.projects.length > 0
          ? dashboardData.projects[0].projectName
          : null;
      }

      // Update global metrics in the hero card
      const heroNumber = document.querySelector(".hero-number");
      if (heroNumber) {
        heroNumber.textContent = numberFormat.format(dashboardData.globalStats.totalFixes);
      }
      const totalSessionsEl = document.getElementById("totalSessions");
      if (totalSessionsEl) {
        totalSessionsEl.textContent = numberFormat.format(dashboardData.globalStats.totalSessions);
      }

      // Update priority breakdown counts
      const pc = dashboardData.globalStats.priorityCounts;
      const p0Val = document.querySelector(".priority-item-p0 .priority-value");
      const p1Val = document.querySelector(".priority-item-p1 .priority-value");
      const p2Val = document.querySelector(".priority-item-p2 .priority-value");
      const p3Val = document.querySelector(".priority-item-p3 .priority-value");
      if (p0Val) p0Val.textContent = pc.P0;
      if (p1Val) p1Val.textContent = pc.P1;
      if (p2Val) p2Val.textContent = pc.P2;
      if (p3Val) p3Val.textContent = pc.P3;

      // Refresh insights section with updated model stats
      const insightsContent = document.getElementById("insightsContent");
      if (insightsContent) {
        insightsContent.innerHTML = buildInsightsContent(
          dashboardData.reviewerModelStats,
          dashboardData.fixerModelStats
        );
      }

      render();
    } catch (err) {
      alert("Failed to delete session: " + err.message);
    }
  };
  window.deleteSession = deleteSession;

  window.addEventListener("resize", render);

  render();
`;

export function buildDashboardScript({
  data,
  viewModel,
  currentProject,
  initialSessionPath,
}: ScriptArgs): string {
  const tokenValues: Record<string, string> = {
    [DATA_TOKEN]: serializeForScript(data),
    [VIEW_MODEL_TOKEN]: serializeForScript(viewModel),
    [PROJECT_TOKEN]: serializeForScript(currentProject),
    [SESSION_TOKEN]: serializeForScript(initialSessionPath),
  };

  return DASHBOARD_SCRIPT_TEMPLATE.replace(
    /__DASHBOARD_DATA__|__DASHBOARD_VIEW_MODEL__|__STATE_PROJECT_NAME__|__STATE_SESSION_PATH__/g,
    (token) => tokenValues[token] ?? token
  );
}
