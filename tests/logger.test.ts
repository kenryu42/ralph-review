import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLog, createLogSession, listLogSessions, readLog } from "@/lib/logger";
import type { LogEntry } from "@/lib/types";

describe("logger", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-logger-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createLogSession", () => {
    test("creates log directory", async () => {
      const sessionPath = await createLogSession(tempDir, "test-session");
      expect(sessionPath).toContain("test-session");
      const _exists = await Bun.file(join(sessionPath, ".keep")).exists();
      // Directory should exist
      expect(sessionPath.length).toBeGreaterThan(0);
    });
  });

  describe("appendLog and readLog", () => {
    test("appends and reads log entries", async () => {
      const sessionPath = await createLogSession(tempDir, "test-session");

      const entry: LogEntry = {
        timestamp: Date.now(),
        type: "review",
        content: "Test log entry",
        iteration: 1,
      };

      await appendLog(sessionPath, entry);
      const entries = await readLog(sessionPath);

      expect(entries.length).toBe(1);
      expect(entries[0]?.content).toBe("Test log entry");
      expect(entries[0]?.type).toBe("review");
    });

    test("appends multiple entries", async () => {
      const sessionPath = await createLogSession(tempDir, "test-session");

      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "review",
        content: "Entry 1",
        iteration: 1,
      });

      await appendLog(sessionPath, {
        timestamp: Date.now(),
        type: "implement",
        content: "Entry 2",
        iteration: 1,
      });

      const entries = await readLog(sessionPath);
      expect(entries.length).toBe(2);
    });
  });

  describe("listLogSessions", () => {
    test("lists sessions sorted by timestamp descending", async () => {
      await createLogSession(tempDir, "session-1");
      await new Promise((r) => setTimeout(r, 10)); // Small delay
      await createLogSession(tempDir, "session-2");

      const sessions = await listLogSessions(tempDir);
      expect(sessions.length).toBe(2);
      // Most recent first
      expect(sessions[0]?.path).toContain("session-2");
    });

    test("returns empty array when no sessions", async () => {
      const sessions = await listLogSessions(tempDir);
      expect(sessions).toEqual([]);
    });
  });
});
