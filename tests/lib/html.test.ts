import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLogHtml, getHtmlPath, writeLogHtml } from "@/lib/html";
import { appendLog, createLogSession } from "@/lib/logger";
import type { IterationEntry, LogEntry, SystemEntry } from "@/lib/types";

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
        fixes: {
          decision: "APPLY_SELECTIVELY",
          fixes: [
            {
              id: 1,
              title: "Fix null check",
              priority: "P1",
              file: "auth.ts",
              claim: "Missing null check",
              evidence: "auth.ts:42",
              fix: "Added null check",
            },
          ],
          skipped: [
            {
              id: 2,
              title: "Minor style issue",
              reason: "Not worth fixing",
            },
          ],
        },
      };

      const html = generateLogHtml([iterEntry]);
      expect(html).toContain("Iteration 1");
      expect(html).toContain("Fix null check");
      expect(html).toContain("P1");
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
          fixes: {
            decision: "APPLY_SELECTIVELY",
            fixes: [],
            skipped: [],
          },
        },
        {
          type: "iteration",
          timestamp: Date.now(),
          iteration: 2,
          fixes: {
            decision: "NO_CHANGES_NEEDED",
            fixes: [],
            skipped: [],
          },
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
});
