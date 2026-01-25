import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLogHtml, writeLogHtml } from "@/lib/html";
import { appendLog, createLogSession } from "@/lib/logger";
import type { LogEntry } from "@/lib/types";

describe("html", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-html-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("generateLogHtml", () => {
    test("generates valid HTML", () => {
      const entries: LogEntry[] = [
        {
          timestamp: Date.now(),
          type: "review",
          content: "Found some issues",
          iteration: 1,
        },
      ];

      const html = generateLogHtml(entries);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    test("includes log content", () => {
      const entries: LogEntry[] = [
        {
          timestamp: Date.now(),
          type: "review",
          content: "Found bug in line 42",
          iteration: 1,
        },
      ];

      const html = generateLogHtml(entries);
      expect(html).toContain("Found bug in line 42");
    });

    test("groups entries by iteration", () => {
      const entries: LogEntry[] = [
        {
          timestamp: Date.now(),
          type: "review",
          content: "Iteration 1 review",
          iteration: 1,
        },
        {
          timestamp: Date.now(),
          type: "fix",
          content: "Iteration 1 fix",
          iteration: 1,
        },
        {
          timestamp: Date.now(),
          type: "review",
          content: "Iteration 2 review",
          iteration: 2,
        },
      ];

      const html = generateLogHtml(entries);
      expect(html).toContain("Iteration 1");
      expect(html).toContain("Iteration 2");
    });

    test("handles empty entries", () => {
      const html = generateLogHtml([]);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("No log entries");
    });
  });

  describe("writeLogHtml", () => {
    test("creates log.html file", async () => {
      const sessionPath = await createLogSession(tempDir, "test-session");

      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "review",
        content: "Test content",
        iteration: 1,
      });

      await writeLogHtml(sessionPath);

      const htmlPath = join(sessionPath, "log.html");
      const exists = await Bun.file(htmlPath).exists();
      expect(exists).toBe(true);
    });

    test("html file is readable", async () => {
      const sessionPath = await createLogSession(tempDir, "test-session");

      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "review",
        content: "Test content",
        iteration: 1,
      });

      await writeLogHtml(sessionPath);

      const htmlPath = join(sessionPath, "log.html");
      const content = await Bun.file(htmlPath).text();
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("Test content");
    });
  });
});
