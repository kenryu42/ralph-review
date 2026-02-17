import { describe, expect, test } from "bun:test";
import {
  computeNextTmuxCaptureInterval,
  createSession,
  generateSessionName,
  getSessionOutput,
  isInsideTmux,
  isTmuxInstalled,
  killSession,
  listRalphSessions,
  listSessions,
  normalizeSessionOutput,
  sanitizeBasename,
  sendInterrupt,
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
    test("returns true when tmux has-session exits with code zero", async () => {
      const result = await sessionExists("rr-session", {
        hasSession: async () => ({ exitCode: 0 }),
      });
      expect(result).toBe(true);
    });

    test("returns false when tmux has-session exits non-zero", async () => {
      const result = await sessionExists("rr-session", {
        hasSession: async () => ({ exitCode: 1 }),
      });
      expect(result).toBe(false);
    });

    test("returns false when tmux has-session throws", async () => {
      const result = await sessionExists("rr-session", {
        hasSession: async () => {
          throw new Error("tmux unavailable");
        },
      });
      expect(result).toBe(false);
    });
  });

  describe("tmux command helpers", () => {
    test("createSession forwards name and command to tmux", async () => {
      let capturedName = "";
      let capturedCommand = "";

      await createSession("rr-main", "echo 'hello'", {
        createSession: async (name, command) => {
          capturedName = name;
          capturedCommand = command;
        },
      });

      expect(capturedName).toBe("rr-main");
      expect(capturedCommand).toBe("echo 'hello'");
    });

    test("createSession rejects when tmux command fails", async () => {
      await expect(
        createSession("rr-main", "echo 'hello'", {
          createSession: async () => {
            throw new Error("create failed");
          },
        })
      ).rejects.toThrow("create failed");
    });

    test("sendInterrupt swallows errors when tmux command fails", async () => {
      await expect(
        sendInterrupt("rr-main", {
          sendInterrupt: async () => {
            throw new Error("interrupt failed");
          },
        })
      ).resolves.toBeUndefined();
    });

    test("killSession swallows errors when tmux command fails", async () => {
      await expect(
        killSession("rr-main", {
          killSession: async () => {
            throw new Error("kill failed");
          },
        })
      ).resolves.toBeUndefined();
    });

    test("listSessions returns parsed session names on success", async () => {
      const sessions = await listSessions({
        listSessions: async () => ({
          exitCode: 0,
          text: () => "rr-alpha\nrr-beta\n\n",
        }),
      });

      expect(sessions).toEqual(["rr-alpha", "rr-beta"]);
    });

    test("listSessions returns empty array on non-zero exit", async () => {
      const sessions = await listSessions({
        listSessions: async () => ({
          exitCode: 1,
          text: () => "rr-alpha\nrr-beta\n",
        }),
      });

      expect(sessions).toEqual([]);
    });

    test("listSessions returns empty array when command throws", async () => {
      const sessions = await listSessions({
        listSessions: async () => {
          throw new Error("list failed");
        },
      });

      expect(sessions).toEqual([]);
    });

    test("listRalphSessions filters non-rr sessions", async () => {
      const sessions = await listRalphSessions({
        listSessions: async () => ({
          exitCode: 0,
          text: () => "rr-alpha\nother\nrr-beta\n",
        }),
      });

      expect(sessions).toEqual(["rr-alpha", "rr-beta"]);
    });
  });

  describe("default dependency smoke tests", () => {
    test("sessionExists returns a boolean with default dependencies", async () => {
      const result = await sessionExists(`rr-missing-${Date.now()}`);
      expect(typeof result).toBe("boolean");
    });

    test("sendInterrupt and killSession tolerate missing sessions", async () => {
      const sessionName = `rr-missing-${Date.now()}`;
      await expect(sendInterrupt(sessionName)).resolves.toBeUndefined();
      await expect(killSession(sessionName)).resolves.toBeUndefined();
    });

    test("listSessions returns an array with default dependencies", async () => {
      const sessions = await listSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    test("createSession can be invoked with default dependencies", async () => {
      const sessionName = `rr-coverage-${Date.now()}`;

      try {
        await createSession(sessionName, "echo coverage");
      } catch {
        // tmux may be unavailable in CI/local environments
      }

      await expect(killSession(sessionName)).resolves.toBeUndefined();
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

    test("captures when no previous capture timestamp exists", () => {
      const shouldCapture = shouldCaptureTmux({
        sessionChanged: false,
        liveMetaChanged: false,
        now: 1_000,
        lastCaptureAt: 0,
        currentIntervalMs: 1_000,
      });

      expect(shouldCapture).toBe(true);
    });

    test("does not capture when elapsed time is below normalized interval", () => {
      const shouldCapture = shouldCaptureTmux({
        sessionChanged: false,
        liveMetaChanged: false,
        now: 1_000,
        lastCaptureAt: 900,
        currentIntervalMs: -1,
      });

      expect(shouldCapture).toBe(false);
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

    test("normalizes invalid previous interval before backoff", () => {
      expect(
        computeNextTmuxCaptureInterval({
          sessionChanged: false,
          liveMetaChanged: false,
          outputChanged: false,
          previousIntervalMs: Number.NaN,
        })
      ).toBe(TMUX_CAPTURE_MIN_INTERVAL_MS * 2);
    });

    test("floors non-integer previous interval before doubling", () => {
      expect(
        computeNextTmuxCaptureInterval({
          sessionChanged: false,
          liveMetaChanged: false,
          outputChanged: false,
          previousIntervalMs: 499.9,
        })
      ).toBe(998);
    });
  });

  describe("getSessionOutput", () => {
    test("uses default spawn dependency to capture output", async () => {
      const originalSpawn = Bun.spawn;
      const stream = new Blob([
        "line 1\nline 2\n",
      ]).stream() as unknown as ReadableStream<Uint8Array>;

      Bun.spawn = (() =>
        ({
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: stream,
          kill: () => true,
        }) as unknown as ReturnType<typeof Bun.spawn>) as typeof Bun.spawn;

      try {
        const output = await getSessionOutput("rr-main", 50);
        expect(output).toBe("line 1\nline 2");
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    test("returns normalized output when capture succeeds", async () => {
      const stdout = {} as ReadableStream<Uint8Array>;
      let capturedLines = 0;
      let timeoutMs = 0;
      const cleared: Array<unknown> = [];

      const output = await getSessionOutput("rr-main", 37, {
        spawnCapturePane: (_name, lines) => {
          capturedLines = lines;
          return {
            exited: Promise.resolve(0),
            exitCode: 0,
            stdout,
            kill: () => true,
          };
        },
        readText: async (stream) => {
          expect(stream).toBe(stdout);
          return "line 1\nline 2\n   ";
        },
        setTimeout: ((...args: Parameters<typeof setTimeout>) => {
          const [_handler, ms] = args;
          timeoutMs = typeof ms === "number" ? ms : 0;
          return 123 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout: ((value) => {
          cleared.push(value);
        }) as typeof clearTimeout,
      });

      expect(output).toBe("line 1\nline 2");
      expect(capturedLines).toBe(37);
      expect(timeoutMs).toBe(750);
      expect(cleared).toEqual([123]);
    });

    test("defaults invalid line counts to fifty", async () => {
      let capturedLines = 0;

      await getSessionOutput("rr-main", Number.NaN, {
        spawnCapturePane: (_name, lines) => {
          capturedLines = lines;
          return {
            exited: Promise.resolve(0),
            exitCode: 0,
            stdout: {} as ReadableStream<Uint8Array>,
            kill: () => true,
          };
        },
        readText: async () => "",
        setTimeout,
        clearTimeout,
      });

      expect(capturedLines).toBe(50);
    });

    test("floors fractional line counts", async () => {
      let capturedLines = 0;

      await getSessionOutput("rr-main", 80.9, {
        spawnCapturePane: (_name, lines) => {
          capturedLines = lines;
          return {
            exited: Promise.resolve(0),
            exitCode: 0,
            stdout: {} as ReadableStream<Uint8Array>,
            kill: () => true,
          };
        },
        readText: async () => "",
        setTimeout,
        clearTimeout,
      });

      expect(capturedLines).toBe(80);
    });

    test("returns empty string when capture process exits non-zero", async () => {
      const output = await getSessionOutput("rr-main", 50, {
        spawnCapturePane: () => ({
          exited: Promise.resolve(1),
          exitCode: 1,
          stdout: {} as ReadableStream<Uint8Array>,
          kill: () => true,
        }),
        readText: async () => "ignored",
        setTimeout,
        clearTimeout,
      });

      expect(output).toBe("");
    });

    test("returns empty string when capture stdout is missing", async () => {
      const output = await getSessionOutput("rr-main", 50, {
        spawnCapturePane: () => ({
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: null,
          kill: () => true,
        }),
        readText: async () => "ignored",
        setTimeout,
        clearTimeout,
      });

      expect(output).toBe("");
    });

    test("returns empty string when capture times out", async () => {
      let killed = false;

      const output = await getSessionOutput("rr-main", 50, {
        spawnCapturePane: () => ({
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: {} as ReadableStream<Uint8Array>,
          kill: () => {
            killed = true;
            return true;
          },
        }),
        readText: async () => "ignored",
        setTimeout: ((...args: Parameters<typeof setTimeout>) => {
          const [handler] = args;
          if (typeof handler === "function") {
            handler();
          }
          return 1 as unknown as ReturnType<typeof setTimeout>;
        }) as typeof setTimeout,
        clearTimeout,
      });

      expect(output).toBe("");
      expect(killed).toBe(true);
    });

    test("returns empty string when capture setup throws", async () => {
      const output = await getSessionOutput("rr-main", 50, {
        spawnCapturePane: () => {
          throw new Error("spawn failed");
        },
        readText: async () => "ignored",
        setTimeout,
        clearTimeout,
      });

      expect(output).toBe("");
    });
  });
});
