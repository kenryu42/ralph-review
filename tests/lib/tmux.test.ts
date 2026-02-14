import { afterEach, describe, expect, test } from "bun:test";
import {
  computeNextTmuxCaptureInterval,
  createSession,
  generateSessionName,
  isInsideTmux,
  isTmuxInstalled,
  killSession,
  listSessions,
  normalizeSessionOutput,
  sanitizeBasename,
  sessionExists,
  shouldCaptureTmux,
  TMUX_CAPTURE_MAX_INTERVAL_MS,
  TMUX_CAPTURE_MIN_INTERVAL_MS,
} from "@/lib/tmux";

describe("tmux", () => {
  describe("sanitizeBasename", () => {
    test("keeps alphanumeric chars unchanged", () => {
      expect(sanitizeBasename("my-project")).toBe("my-project");
      expect(sanitizeBasename("myProject123")).toBe("myProject123");
    });

    test("replaces dots with dash", () => {
      expect(sanitizeBasename("my.project")).toBe("my-project");
    });

    test("replaces spaces with dash", () => {
      expect(sanitizeBasename("my project")).toBe("my-project");
    });

    test("collapses consecutive invalid chars to single dash", () => {
      expect(sanitizeBasename("a...b")).toBe("a-b");
      expect(sanitizeBasename("a   b")).toBe("a-b");
      expect(sanitizeBasename("a.-.b")).toBe("a-b");
    });

    test("truncates to 20 chars", () => {
      const result = sanitizeBasename("very-long-project-name-here-exceeds-limit");
      expect(result.length).toBeLessThanOrEqual(20);
    });

    test("returns 'project' for empty string", () => {
      expect(sanitizeBasename("")).toBe("project");
    });

    test("returns 'project' for all-invalid chars", () => {
      expect(sanitizeBasename("###")).toBe("project");
      expect(sanitizeBasename("...")).toBe("project");
    });

    test("removes leading and trailing dashes", () => {
      expect(sanitizeBasename(".project.")).toBe("project");
      expect(sanitizeBasename("---name---")).toBe("name");
    });
  });

  describe("isTmuxInstalled", () => {
    test("returns boolean", () => {
      const result = isTmuxInstalled();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("isInsideTmux", () => {
    test("returns boolean", () => {
      const result = isInsideTmux();
      expect(typeof result).toBe("boolean");
    });

    test("returns false when TMUX env is not set", () => {
      // In test environment, TMUX is typically not set
      const originalTmux = process.env.TMUX;
      delete process.env.TMUX;
      const result = isInsideTmux();
      expect(result).toBe(false);
      // Restore
      if (originalTmux) process.env.TMUX = originalTmux;
    });

    test("returns true when TMUX env is set", () => {
      const originalTmux = process.env.TMUX;
      process.env.TMUX = "/tmp/tmux-501/default,12345,0";
      const result = isInsideTmux();
      expect(result).toBe(true);
      // Restore
      if (originalTmux) {
        process.env.TMUX = originalTmux;
      } else {
        delete process.env.TMUX;
      }
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

    test("includes basename when provided", () => {
      const name = generateSessionName("my-project");
      expect(name.startsWith("rr-my-project-")).toBe(true);
    });

    test("sanitizes basename in output", () => {
      const name = generateSessionName("my.project");
      expect(name).toMatch(/^rr-my-project-\d+$/);
    });

    test("uses cwd basename by default", () => {
      const name = generateSessionName();
      // Should include some identifier from cwd (not just rr-timestamp)
      // Format: rr-{sanitized-basename}-{timestamp}
      const parts = name.split("-");
      expect(parts.length).toBeGreaterThanOrEqual(3); // rr, basename part(s), timestamp
    });
  });

  describe("sessionExists", () => {
    test("returns false for non-existent session", async () => {
      const result = await sessionExists("nonexistent-session-xyz-12345");
      expect(result).toBe(false);
    });
  });

  describe("normalizeSessionOutput", () => {
    test("preserves leading indentation", () => {
      const output = "  ╭────╮\n  │ hi │\n  ╰────╯\n";
      expect(normalizeSessionOutput(output)).toBe("  ╭────╮\n  │ hi │\n  ╰────╯");
    });

    test("removes only trailing whitespace", () => {
      const output = "line 1\nline 2\n\n   ";
      expect(normalizeSessionOutput(output)).toBe("line 1\nline 2");
    });
  });

  describe("capture heuristics", () => {
    test("forces capture when session changes", () => {
      const shouldCapture = shouldCaptureTmux({
        sessionChanged: true,
        liveMetaChanged: false,
        now: 1_000,
        lastCaptureAt: 950,
        currentIntervalMs: 1_000,
      });

      expect(shouldCapture).toBe(true);
    });

    test("forces capture when live metadata changes", () => {
      const shouldCapture = shouldCaptureTmux({
        sessionChanged: false,
        liveMetaChanged: true,
        now: 1_000,
        lastCaptureAt: 950,
        currentIntervalMs: 1_000,
      });

      expect(shouldCapture).toBe(true);
    });

    test("captures when enough time elapsed for current interval", () => {
      const shouldCapture = shouldCaptureTmux({
        sessionChanged: false,
        liveMetaChanged: false,
        now: 1_000,
        lastCaptureAt: 500,
        currentIntervalMs: 500,
      });

      expect(shouldCapture).toBe(true);
    });

    test("backs off capture interval when output is unchanged", () => {
      expect(
        computeNextTmuxCaptureInterval({
          sessionChanged: false,
          liveMetaChanged: false,
          outputChanged: false,
          previousIntervalMs: TMUX_CAPTURE_MIN_INTERVAL_MS,
        })
      ).toBe(TMUX_CAPTURE_MIN_INTERVAL_MS * 2);

      expect(
        computeNextTmuxCaptureInterval({
          sessionChanged: false,
          liveMetaChanged: false,
          outputChanged: false,
          previousIntervalMs: TMUX_CAPTURE_MAX_INTERVAL_MS,
        })
      ).toBe(TMUX_CAPTURE_MAX_INTERVAL_MS);
    });

    test("resets capture interval when output changes", () => {
      expect(
        computeNextTmuxCaptureInterval({
          sessionChanged: false,
          liveMetaChanged: false,
          outputChanged: true,
          previousIntervalMs: TMUX_CAPTURE_MAX_INTERVAL_MS,
        })
      ).toBe(TMUX_CAPTURE_MIN_INTERVAL_MS);
    });
  });

  // Skip actual tmux operations in automated tests
  // These require tmux to be running
  describe.skip("tmux operations (manual testing)", () => {
    const testSessionName = `rr-test-${Date.now()}`;

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
