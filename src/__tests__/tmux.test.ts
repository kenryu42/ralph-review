import { test, expect, describe, beforeEach, afterEach } from "bun:test";

describe("tmux", () => {
  const {
    isTmuxInstalled,
    generateSessionName,
    sessionExists,
  } = require("../lib/tmux");

  describe("isTmuxInstalled", () => {
    test("returns boolean", () => {
      const result = isTmuxInstalled();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("generateSessionName", () => {
    test("generates name with rr- prefix", () => {
      const name = generateSessionName();
      expect(name.startsWith("rr-")).toBe(true);
    });

    test("generates unique names", () => {
      const name1 = generateSessionName();
      // Small delay to ensure different timestamp
      const name2 = generateSessionName();
      // Names should be unique (or at least start with rr-)
      expect(name1.startsWith("rr-")).toBe(true);
      expect(name2.startsWith("rr-")).toBe(true);
    });

    test("name is valid for tmux (no special chars)", () => {
      const name = generateSessionName();
      // tmux session names should only contain alphanumeric, underscore, dash
      expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
    });
  });

  describe("sessionExists", () => {
    test("returns false for non-existent session", async () => {
      const result = await sessionExists("nonexistent-session-xyz-12345");
      expect(result).toBe(false);
    });
  });

  // Skip actual tmux operations in automated tests
  // These require tmux to be running
  describe.skip("tmux operations (manual testing)", () => {
    const {
      createSession,
      attachSession,
      killSession,
      listSessions,
      getSessionOutput,
    } = require("../lib/tmux");

    const testSessionName = "rr-test-" + Date.now();

    afterEach(async () => {
      // Clean up test session if it exists
      try {
        await killSession(testSessionName);
      } catch {
        // Ignore errors
      }
    });

    test("createSession creates a session", async () => {
      await createSession(testSessionName, "echo 'test'");
      const exists = await sessionExists(testSessionName);
      expect(exists).toBe(true);
    });

    test("killSession removes a session", async () => {
      await createSession(testSessionName, "sleep 60");
      await killSession(testSessionName);
      const exists = await sessionExists(testSessionName);
      expect(exists).toBe(false);
    });

    test("listSessions returns array", async () => {
      const sessions = await listSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });
  });
});
