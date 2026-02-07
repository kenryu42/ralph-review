import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateDashboardHtml,
  generateLogHtml,
  getDashboardPath,
  getHtmlPath,
  writeDashboardHtml,
  writeLogHtml,
} from "@/lib/html";
import { appendLog, createLogSession } from "@/lib/logger";
import type {
  DashboardData,
  IterationEntry,
  LogEntry,
  SessionStats,
  SystemEntry,
} from "@/lib/types";
import { buildFixSummary, buildSkippedEntry } from "../test-utils/fix-summary";

describe("html", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-html-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getHtmlPath", () => {
    test("replaces .jsonl with .html", () => {
      expect(getHtmlPath("/path/to/log.jsonl")).toBe("/path/to/log.html");
    });
  });

  describe("generateLogHtml", () => {
    test("generates valid HTML structure", () => {
      const entries: LogEntry[] = [];

      const html = generateLogHtml(entries);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    test("handles empty entries", () => {
      const html = generateLogHtml([]);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("No log entries");
    });

    test("renders system entry with project info", () => {
      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/path/to/project",
        gitBranch: "main",
        reviewer: { agent: "codex", model: "gpt-4" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };

      const html = generateLogHtml([systemEntry]);
      expect(html).toContain("/path/to/project");
      expect(html).toContain("main");
      expect(html).toContain("codex");
      expect(html).toContain("gpt-4");
      expect(html).toContain("claude");
      expect(html).toContain("5");
    });

    test("renders iteration entry with fixes", () => {
      const iterEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        duration: 5000,
        fixes: buildFixSummary({
          decision: "APPLY_SELECTIVELY",
          fixes: [
            {
              id: 1,
              title: "Fix null check",
              priority: "P0",
              file: "auth.ts",
              claim: "Missing null check",
              evidence: "auth.ts:42",
              fix: "Added null check",
            },
          ],
          skipped: [
            buildSkippedEntry({
              id: 2,
              title: "Minor style issue",
              priority: "P3",
              reason: "Not worth fixing",
            }),
          ],
        }),
      };

      const html = generateLogHtml([iterEntry]);
      expect(html).toContain("Iteration 1");
      expect(html).toContain("Fix null check");
      expect(html).toContain("P0");
      expect(html).toContain("auth.ts");
      expect(html).toContain("Minor style issue");
    });

    test("renders iteration entry with error", () => {
      const iterEntry: IterationEntry = {
        type: "iteration",
        timestamp: Date.now(),
        iteration: 1,
        error: {
          phase: "reviewer",
          message: "Agent crashed",
          exitCode: 1,
        },
      };

      const html = generateLogHtml([iterEntry]);
      expect(html).toContain("Iteration 1");
      expect(html).toContain("reviewer");
      expect(html).toContain("Agent crashed");
    });

    test("renders multiple iterations", () => {
      const entries: LogEntry[] = [
        {
          type: "system",
          timestamp: Date.now(),
          projectPath: "/test",
          reviewer: { agent: "codex" },
          fixer: { agent: "claude" },
          maxIterations: 5,
        },
        {
          type: "iteration",
          timestamp: Date.now(),
          iteration: 1,
          fixes: buildFixSummary({ decision: "APPLY_SELECTIVELY" }),
        },
        {
          type: "iteration",
          timestamp: Date.now(),
          iteration: 2,
          fixes: buildFixSummary({ decision: "NO_CHANGES_NEEDED", stop_iteration: true }),
        },
      ];

      const html = generateLogHtml(entries);
      expect(html).toContain("Iteration 1");
      expect(html).toContain("Iteration 2");
    });
  });

  describe("writeLogHtml", () => {
    test("creates HTML file next to JSONL log", async () => {
      const logPath = await createLogSession(tempDir, "/test/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/test/project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      await appendLog(logPath, systemEntry);

      await writeLogHtml(logPath);

      const htmlPath = getHtmlPath(logPath);
      const exists = await Bun.file(htmlPath).exists();
      expect(exists).toBe(true);
    });

    test("HTML file contains log data", async () => {
      const logPath = await createLogSession(tempDir, "/test/project");

      const systemEntry: SystemEntry = {
        type: "system",
        timestamp: Date.now(),
        projectPath: "/test/my-project",
        reviewer: { agent: "codex" },
        fixer: { agent: "claude" },
        maxIterations: 5,
      };
      await appendLog(logPath, systemEntry);

      await writeLogHtml(logPath);

      const htmlPath = getHtmlPath(logPath);
      const content = await Bun.file(htmlPath).text();
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("/test/my-project");
    });
  });

  describe("getDashboardPath", () => {
    test("returns dashboard.html path in logs directory", () => {
      const path = getDashboardPath("/path/to/logs");
      expect(path).toBe("/path/to/logs/dashboard.html");
    });
  });

  describe("generateDashboardHtml", () => {
    const createTestDashboardData = (): DashboardData => ({
      generatedAt: Date.now(),
      currentProject: "work-project-a",
      globalStats: {
        totalFixes: 42,
        totalSkipped: 5,
        priorityCounts: { P0: 10, P1: 15, P2: 12, P3: 5 },
        totalSessions: 8,
        averageIterations: 2.5,
        fixRate: 0.89,
      },
      projects: [
        {
          projectName: "work-project-a",
          displayName: "project-a",
          totalFixes: 25,
          totalSkipped: 3,
          priorityCounts: { P0: 8, P1: 10, P2: 5, P3: 2 },
          sessionCount: 5,
          averageIterations: 2.5,
          fixRate: 0.89,
          sessions: [
            {
              sessionPath: "/logs/work-project-a/session1.jsonl",
              sessionName: "2026-01-27T10-00-00_main.jsonl",
              timestamp: Date.now(),
              gitBranch: "main",
              status: "completed",
              totalFixes: 10,
              totalSkipped: 1,
              priorityCounts: { P0: 3, P1: 4, P2: 2, P3: 1 },
              iterations: 2,
              entries: [],
              reviewer: "claude",
              reviewerModel: "claude-sonnet-4-20250514",
              reviewerDisplayName: "Claude",
              reviewerModelDisplayName: "claude-sonnet-4-20250514",
              fixer: "claude",
              fixerModel: "claude-sonnet-4-20250514",
              fixerDisplayName: "Claude",
              fixerModelDisplayName: "claude-sonnet-4-20250514",
            } as SessionStats,
          ],
        },
        {
          projectName: "work-project-b",
          displayName: "project-b",
          totalFixes: 17,
          totalSkipped: 2,
          priorityCounts: { P0: 2, P1: 5, P2: 7, P3: 3 },
          sessionCount: 3,
          averageIterations: 2,
          fixRate: 0.89,
          sessions: [],
        },
      ],
      reviewerAgentStats: [],
      fixerAgentStats: [],
      reviewerModelStats: [],
      fixerModelStats: [],
    });

    test("generates valid HTML structure", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    test("includes dashboard title", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("Ralph Review Dashboard");
    });

    test("shows total fixes prominently", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("42");
      expect(html).toContain("Issues Resolved");
    });

    test("includes priority breakdown", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("P1");
      expect(html).toContain("10");
      expect(html).toContain("P2");
      expect(html).toContain("15");
    });

    test("includes all projects in sidebar", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("project-a");
      expect(html).toContain("project-b");
    });

    test("marks current project as selected", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      // The current project data should be embedded
      expect(html).toContain("work-project-a");
      expect(html).toContain("currentProject");
    });

    test("shows total sessions in header", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("Total Sessions");
      expect(html).toContain(">8<");
      expect(html).not.toContain("Success Rate");
      expect(html).not.toContain(">87%<");
      expect(html).not.toContain('class="summary-value" id="totalSkipped"');
      expect(html).not.toContain('<div class="summary-label">Skipped</div>');
    });

    test("handles empty projects", () => {
      const data: DashboardData = {
        generatedAt: Date.now(),
        globalStats: {
          totalFixes: 0,
          totalSkipped: 0,
          priorityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
          totalSessions: 0,
          averageIterations: 0,
          fixRate: 0,
        },
        projects: [],
        reviewerAgentStats: [],
        fixerAgentStats: [],
        reviewerModelStats: [],
        fixerModelStats: [],
      };
      const html = generateDashboardHtml(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("0");
    });

    test("embeds dashboard data as JSON", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      // Data should be embedded for client-side JS navigation
      expect(html).toContain("dashboardData");
      // Data is embedded directly as JSON object, not via JSON.parse
      expect(html).toContain("const dashboardData =");
    });

    test("renders insights rows with agent and thinking badges", () => {
      const data = createTestDashboardData();
      data.reviewerModelStats = [
        {
          agent: "claude",
          model: "claude-sonnet-4-20250514",
          displayName: "Claude Sonnet 4",
          thinkingLevel: "high",
          totalIssues: 10,
          sessionCount: 5,
          totalSkipped: 2,
          averageIterations: 3,
        },
      ];
      data.fixerModelStats = [
        {
          agent: "codex",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          thinkingLevel: "default",
          totalIssues: 5,
          sessionCount: 2,
          totalSkipped: 1,
          averageIterations: 2,
        },
      ];
      const html = generateDashboardHtml(data);

      expect(html).toContain("Reviewer");
      expect(html).toContain("Claude");
      expect(html).toContain("HIGH");
      expect(html).toContain("10");
      expect(html).toContain('class="agent-runs-count">5<');
      expect(html).toContain('class="agent-metric" title="Issues Found"');
      expect(html).toContain('class="agent-metric agent-metric-agent"');
      expect(html).toContain('class="agent-metric agent-metric-thinking"');

      expect(html).toContain("Fixer");
      expect(html).toContain("Codex");
      expect(html).toContain("DEFAULT");
      expect(html).toContain("5");
      expect(html).toContain('class="agent-runs-count">2<');
      expect(html).toContain('class="agent-metric agent-metric-fixer" title="Issues Fixed"');
    });

    test("renders model stats with display names and tooltips", () => {
      const data = createTestDashboardData();
      data.reviewerModelStats = [
        {
          agent: "claude",
          model: "claude-sonnet-4-20250514",
          displayName: "Claude Sonnet 4",
          thinkingLevel: "high",
          totalIssues: 12,
          sessionCount: 4,
          totalSkipped: 3,
          averageIterations: 2,
        },
      ];
      data.fixerModelStats = [
        {
          agent: "codex",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          thinkingLevel: "default",
          totalIssues: 7,
          sessionCount: 3,
          totalSkipped: 1,
          averageIterations: 1.5,
        },
      ];
      const html = generateDashboardHtml(data);

      expect(html).toContain("Reviewer");
      expect(html).toContain("Claude Sonnet 4");
      expect(html).toContain('title="claude-sonnet-4-20250514"');
      expect(html).toContain("HIGH");
      expect(html).toContain("12");
      expect(html).toContain('class="agent-runs-count">4<');
      expect(html).toContain('class="agent-metric" title="Issues Found"');

      expect(html).toContain("Fixer");
      expect(html).toContain("GPT-4.1");
      expect(html).toContain('title="gpt-4.1"');
      expect(html).toContain("DEFAULT");
      expect(html).toContain("7");
      expect(html).toContain('class="agent-runs-count">3<');
      expect(html).toContain('class="agent-metric agent-metric-fixer" title="Issues Fixed"');
    });

    test("sorts insights rows by totalIssues descending", () => {
      const data = createTestDashboardData();
      data.reviewerModelStats = [
        {
          agent: "codex",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          thinkingLevel: "default",
          totalIssues: 1,
          sessionCount: 5,
          totalSkipped: 0,
          averageIterations: 1,
        },
        {
          agent: "claude",
          model: "claude-sonnet",
          displayName: "Claude Sonnet",
          thinkingLevel: "high",
          totalIssues: 15,
          sessionCount: 2,
          totalSkipped: 0,
          averageIterations: 1,
        },
      ];
      const html = generateDashboardHtml(data);

      const sonnetPos = html.indexOf("Claude Sonnet");
      const gptPos = html.indexOf("GPT-4.1");
      expect(sonnetPos).toBeLessThan(gptPos);
    });

    test("wraps insights stats in a single collapsible Insights section", () => {
      const data = createTestDashboardData();
      data.fixerModelStats = [
        {
          agent: "codex",
          model: "gpt-4.1",
          displayName: "GPT-4.1",
          thinkingLevel: "default",
          totalIssues: 7,
          sessionCount: 3,
          totalSkipped: 1,
          averageIterations: 1.5,
        },
      ];
      const html = generateDashboardHtml(data);

      expect(html).toContain('<details class="insights-section"');
      expect(html).toContain("<summary");
      expect(html).toContain("Insights");
    });

    test("omits Insights section when all stats are empty", () => {
      const data = createTestDashboardData();
      data.reviewerAgentStats = [];
      data.fixerAgentStats = [];
      data.reviewerModelStats = [];
      data.fixerModelStats = [];
      const html = generateDashboardHtml(data);

      expect(html).not.toContain('<details class="insights-section"');
    });

    test("renders model stats using same layout as agent stats", () => {
      const data = createTestDashboardData();
      const longModel =
        "llm-proxy/claude-opus-4-5-thinking-super-long-model-id-with-no-spaces-20260101";
      data.reviewerModelStats = [
        {
          agent: "claude",
          model: longModel,
          displayName: longModel,
          thinkingLevel: "default",
          totalIssues: 21,
          sessionCount: 9,
          totalSkipped: 3,
          averageIterations: 2.2,
        },
      ];
      data.fixerModelStats = [];
      data.reviewerAgentStats = [];
      data.fixerAgentStats = [];

      const html = generateDashboardHtml(data);

      expect(html).toContain("Reviewer");
      expect(html).toContain(longModel);
      expect(html).toContain('class="agent-runs-count">9<');
      expect(html).toContain('title="Issues Found"');
      expect(html).toContain('class="agent-row"');
      expect(html).toContain('class="agent-name"');
      expect(html).toContain(`title="${longModel}"`);
    });

    test("does not render removed reviewer and fixer agent section labels", () => {
      const data = createTestDashboardData();
      data.reviewerModelStats = [
        {
          agent: "claude",
          model: "claude-sonnet-4-20250514",
          displayName: "Claude Sonnet 4",
          thinkingLevel: "high",
          totalIssues: 12,
          sessionCount: 4,
          totalSkipped: 3,
          averageIterations: 2,
        },
      ];

      const html = generateDashboardHtml(data);

      expect(html).not.toContain("Reviewer Agents");
      expect(html).not.toContain("Fixer Agents");
    });

    test("uses 500px desktop columns for aside and session list", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain("grid-template-columns: 500px 1fr;");
      expect(html).toContain("grid-template-columns: 75px minmax(0, 1fr) 65px max-content 48px;");
      expect(html).toContain("grid-template-columns: 3ch max-content;");
    });

    test("places thinking badge beside agent on mobile insights rows", () => {
      const data = createTestDashboardData();
      const html = generateDashboardHtml(data);

      expect(html).toContain(
        "grid-template-columns: 75px fit-content(34ch) 65px 1fr max-content 48px;"
      );
      expect(html).toContain('grid-template-areas: "agent model thinking . runs issues";');
      expect(html).toContain("justify-self: start;");
    });
  });

  describe("writeDashboardHtml", () => {
    test("creates dashboard.html file", async () => {
      const data: DashboardData = {
        generatedAt: Date.now(),
        globalStats: {
          totalFixes: 5,
          totalSkipped: 1,
          priorityCounts: { P0: 2, P1: 2, P2: 1, P3: 0 },
          totalSessions: 2,
          averageIterations: 1.5,
          fixRate: 0.83,
        },
        projects: [],
        reviewerAgentStats: [],
        fixerAgentStats: [],
        reviewerModelStats: [],
        fixerModelStats: [],
      };

      const dashboardPath = join(tempDir, "dashboard.html");
      await writeDashboardHtml(dashboardPath, data);

      const exists = await Bun.file(dashboardPath).exists();
      expect(exists).toBe(true);
    });

    test("dashboard file contains correct data", async () => {
      const data: DashboardData = {
        generatedAt: Date.now(),
        globalStats: {
          totalFixes: 42,
          totalSkipped: 3,
          priorityCounts: { P0: 10, P1: 15, P2: 12, P3: 5 },
          totalSessions: 5,
          averageIterations: 2,
          fixRate: 0.93,
        },
        projects: [],
        reviewerAgentStats: [],
        fixerAgentStats: [],
        reviewerModelStats: [],
        fixerModelStats: [],
      };

      const dashboardPath = join(tempDir, "dashboard.html");
      await writeDashboardHtml(dashboardPath, data);

      const content = await Bun.file(dashboardPath).text();
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("42");
      expect(content).toContain("Total Sessions");
      expect(content).toContain(">5<");
      expect(content).not.toContain("Success Rate");
      expect(content).not.toContain(">80%<");
    });
  });
});
