import { PRIORITY_COLORS } from "@/lib/tui/session-panel-utils";

export const DASHBOARD_CSS = `
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
    --accent-4: #c59dff;
    --success: #45d49f;
    --warning: #f4c34f;
    --danger: #ff7b7b;
    --shadow: rgba(3, 8, 20, 0.5);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    height: 100vh;
    overflow: hidden;
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
    grid-template-columns: 500px 1fr;
    height: 100vh;
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
    overflow-y: auto;
    min-height: 0;
  }
  main {
    padding: 32px 36px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-height: 0;
  }
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
    overflow-x: clip;
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .priority-value {
    display: inline-block;
    font-size: 18px;
    font-weight: 600;
    margin-top: 4px;
    line-height: 1;
    min-inline-size: 3ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }
  .priority-item-p0 .priority-label { color: ${PRIORITY_COLORS.P0}; }
  .priority-item-p1 .priority-label { color: ${PRIORITY_COLORS.P1}; }
  .priority-item-p2 .priority-label { color: ${PRIORITY_COLORS.P2}; }
  .priority-item-p3 .priority-label { color: ${PRIORITY_COLORS.P3}; }
  .section-title { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
  .project-list, .session-list { display: grid; gap: 10px; }
  .session-list {
    overflow-y: auto;
    min-height: 0;
    flex: 1;
    scrollbar-gutter: stable;
    padding-top: 6px;
    padding-bottom: 6px;
    align-content: start;
    grid-auto-rows: max-content;
  }
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
  .session-card {
    position: relative;
    padding-right: 130px;
  }
  .session-card .status {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
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
  }
  .summary-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; }
  .summary-value { font-size: 20px; font-weight: 600; margin-top: 6px; text-align: center; }
  .content-grid {
    display: grid;
    grid-template-columns: 500px 1fr;
    grid-template-rows: 1fr;
    gap: 24px;
    flex: 1;
    min-height: 0;
  }
  .content-grid > div:first-child {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .session-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .session-title { font-weight: 600; font-size: 15px; }
  .session-meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .session-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .session-stats { display: flex; gap: 12px; color: var(--muted); font-size: 12px; margin-top: 8px; }
  .status {
    min-width: 100px;
    min-height: 28px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: inline-flex;
    align-items: center;
    align-self: center;
    justify-content: center;
    line-height: 1;
  }
  .status-has-fixes,
  .status-no-issues {
    text-align: center;
    justify-content: center;
    display: inline-flex;
    align-items: center;
    align-self: center;
  }
  .status-has-fixes { background: rgba(69, 212, 159, 0.18); color: var(--success); }
  .status-no-issues { background: rgba(126, 178, 255, 0.18); color: var(--accent-3); }
  .status-has-skipped { background: rgba(244, 195, 79, 0.18); color: var(--warning); }
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
    overflow: auto;
    min-height: 0;
  }
  .session-inline-detail {
    display: none;
    min-height: 0;
  }
  .detail-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .detail-header { display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .detail-title { font-family: "Space Grotesk", sans-serif; font-size: 20px; font-weight: 600; }
  .detail-meta {
    color: rgba(237, 242, 255, 0.78);
    font-size: 14px;
    line-height: 1.5;
    font-weight: 500;
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .detail-meta .dot { color: rgba(237, 242, 255, 0.45); }
  .detail-meta-label { color: var(--muted); font-weight: 600; }
  .detail-stats { display: flex; gap: 12px; }
  .stat { background: var(--panel-2); border-radius: 12px; padding: 10px 12px; min-width: 90px; text-align: center; }
  .stat-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
  .stat-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
  .stat-code-simplified {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stat-code-simplified .stat-value {
    margin-top: 0;
    font-size: 12px;
    letter-spacing: 0.08em;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    line-height: 1.05;
  }
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
  .skip-item.no-pill { grid-template-columns: 1fr; }
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
  .filter-wrapper {
    position: relative;
    margin-top: 10px;
    margin-bottom: 10px;
  }
  .filter {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 8px 36px 8px 12px;
    color: var(--text);
    font-size: 13px;
    width: 100%;
  }
  .filter:focus {
    outline: none;
    border-color: var(--accent-3);
  }
  .filter-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }
  .filter-wrapper.has-value .filter-clear {
    opacity: 1;
    pointer-events: auto;
  }
  .filter-clear:hover {
    color: var(--text);
  }
  .filter-count {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .agent-section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    min-width: 0;
  }
  .agent-section:first-of-type {
    border-top: none;
    padding-top: 0;
    margin-top: 16px;
  }
  .agent-section-label {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .insights-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    min-width: 0;
  }
  .insights-label {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    cursor: pointer;
    list-style: none;
  }
  .insights-label::-webkit-details-marker { display: none; }
  .insights-label::before {
    content: "\\25B8";
    display: inline-block;
    margin-right: 6px;
    transition: transform 120ms ease;
  }
  .insights-section[open] > .insights-label::before {
    transform: rotate(90deg);
  }
  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .agent-row {
    display: grid;
    grid-template-columns: 75px minmax(0, 1fr) 65px max-content 48px;
    align-items: center;
    column-gap: 8px;
    font-size: 13px;
    min-width: 0;
  }
  .agent-name {
    min-width: 0;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-runs {
    font-size: 12px;
    color: var(--muted);
    display: inline-grid;
    grid-template-columns: 3ch max-content;
    justify-content: end;
    column-gap: 4px;
    white-space: nowrap;
  }
  .agent-runs-count {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }
  .agent-metric {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    color: var(--accent);
    background: rgba(244, 195, 79, 0.12);
    padding: 2px 0;
    border-radius: 6px;
    inline-size: 48px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
  }
  .agent-metric-fixer {
    background: rgba(69, 212, 159, 0.18);
    color: var(--success);
  }
  .agent-metric-agent,
  .agent-metric-reasoning {
    padding: 2px 6px;
    font-size: 11px;
    border-radius: 999px;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }
  .agent-metric-agent {
    inline-size: 75px;
  }
  .agent-metric-reasoning {
    inline-size: 65px;
  }
  .agent-metric-agent {
    background: rgba(126, 178, 255, 0.18);
    color: var(--accent-3);
  }
  .agent-metric-reasoning {
    background: rgba(197, 157, 255, 0.2);
    color: var(--accent-4);
  }
  .mono { font-family: "Space Grotesk", monospace; }
  .icon-btn {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 8px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease;
    opacity: 0.7;
  }
  .icon-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
  }
  .icon-btn.delete:hover {
    background: rgba(255, 123, 123, 0.15);
    color: var(--danger);
  }
  .icon-btn svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
  }
  @media (min-width: 1281px) {
    .detail-meta-block {
      margin-top: 10px;
    }
  }
  @media (max-width: 1280px) {
    body { height: auto; overflow: auto; }
    .app { height: auto; }
    main { min-height: 100vh; }
    .app { grid-template-columns: 1fr; }
    aside { border-right: none; border-bottom: 1px solid var(--border); }
    .content-grid { grid-template-columns: 1fr; }
    .desktop-detail { display: none; }
    .session-inline-detail { display: block; }
    .session-list { overflow: visible; }
    .detail-card { overflow: visible; }
    .detail-meta { row-gap: 6px; }
    .detail-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: 12px;
      align-items: start;
      width: 100%;
    }
    .detail-summary .detail-meta { grid-column: 1; }
    .detail-summary .detail-stats {
      grid-column: 2;
      grid-row: 1 / span 3;
      margin-top: 0;
      justify-self: end;
    }
    .agent-row {
      grid-template-columns: 75px fit-content(34ch) 65px 1fr max-content 48px;
      grid-template-areas: "agent model reasoning . runs issues";
    }
    .agent-row > .agent-metric-agent {
      grid-area: agent;
    }
    .agent-row > .agent-name {
      grid-area: model;
      max-inline-size: 100%;
    }
    .agent-row > .agent-metric-reasoning {
      grid-area: reasoning;
      justify-self: start;
    }
    .agent-row > .agent-runs {
      grid-area: runs;
    }
    .agent-row > .agent-metric:not(.agent-metric-agent):not(.agent-metric-reasoning) {
      grid-area: issues;
    }
  }
`;
