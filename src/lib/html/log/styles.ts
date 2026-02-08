import { PRIORITY_COLORS } from "@/lib/tui/session-panel-utils";

export const LOG_CSS = `
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
    --success: #45d49f;
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
    justify-content: center;
    line-height: 1;
  }
  .status-has-fixes {
    text-align: center;
    background: rgba(69, 212, 159, 0.18);
    color: var(--success);
  }
  .card-title { font-weight: 600; font-size: 18px; margin-bottom: 16px; }
  .iteration-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .iteration-title { font-weight: 600; font-size: 17px; }
  .iteration-meta { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .dot { opacity: 0.6; }
  .section-title { margin: 16px 0 8px; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .fix-list, .skip-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .fix-item, .skip-item { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 12px; background: var(--panel-strong); border-radius: 12px; border: 1px solid transparent; }
  .skip-item.no-pill { grid-template-columns: 1fr; }
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
`;
