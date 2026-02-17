import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { playCompletionSound, resolveSoundEnabled } from "@/lib/notify/sound";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

type SpawnProcess = ReturnType<typeof Bun.spawn>;

const baseConfig: Config = {
  $schema: CONFIG_SCHEMA_URI,
  version: CONFIG_VERSION,
  reviewer: { agent: "codex" },
  fixer: { agent: "claude" },
  maxIterations: 5,
  iterationTimeout: 1800000,
  defaultReview: { type: "uncommitted" },
  notifications: { sound: { enabled: false } },
};

let originalSpawn: typeof Bun.spawn;
let originalSetTimeout: typeof globalThis.setTimeout;
let originalStdoutWrite: typeof process.stdout.write;

function createMockProcess(exited: Promise<number>, onKill?: () => void): SpawnProcess {
  return {
    exited,
    kill: () => {
      onKill?.();
      return true;
    },
  } as unknown as SpawnProcess;
}

describe("sound notifications", () => {
  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalSetTimeout = globalThis.setTimeout;
    originalStdoutWrite = process.stdout.write;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    globalThis.setTimeout = originalSetTimeout;
    process.stdout.write = originalStdoutWrite;
  });

  describe("resolveSoundEnabled", () => {
    test("returns config value when no override is provided", () => {
      expect(resolveSoundEnabled(baseConfig)).toBe(false);
      expect(
        resolveSoundEnabled({
          ...baseConfig,
          notifications: { sound: { enabled: true } },
        })
      ).toBe(true);
    });

    test("override on takes precedence over config", () => {
      expect(resolveSoundEnabled(baseConfig, "on")).toBe(true);
    });

    test("override off takes precedence over config", () => {
      expect(
        resolveSoundEnabled(
          {
            ...baseConfig,
            notifications: { sound: { enabled: true } },
          },
          "off"
        )
      ).toBe(false);
    });
  });

  describe("playCompletionSound", () => {
    test("falls back to bell on unsupported platforms with no candidates", async () => {
      let bellCalled = false;

      const result = await playCompletionSound("success", {
        platform: "freebsd",
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("uses default bell writer when no backends are available", async () => {
      let bellWrites = 0;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        if (chunk === "\u0007") {
          bellWrites += 1;
        }
        return true;
      }) as typeof process.stdout.write;

      const result = await playCompletionSound("success", {
        platform: "freebsd",
      });

      expect(result.played).toBe(true);
      expect(bellWrites).toBe(1);
    });

    test("plays macOS afplay when available", async () => {
      const attempted: string[][] = [];

      const result = await playCompletionSound("success", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        spawnAndWait: async (command) => {
          attempted.push(command);
          return true;
        },
      });

      expect(result.played).toBe(true);
      expect(attempted).toEqual([["afplay", "/System/Library/Sounds/Glass.aiff"]]);
    });

    test("uses internal spawn path when backend exits with zero", async () => {
      const attempted: string[][] = [];
      let bellCalled = false;

      Bun.spawn = ((command) => {
        attempted.push(command as string[]);
        return createMockProcess(Promise.resolve(0));
      }) as typeof Bun.spawn;

      const result = await playCompletionSound("success", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(attempted).toEqual([["afplay", "/System/Library/Sounds/Glass.aiff"]]);
      expect(bellCalled).toBe(false);
    });

    test("falls back through linux backends in order", async () => {
      const attempted: string[][] = [];
      let bellCalled = false;

      const result = await playCompletionSound("warning", {
        platform: "linux",
        which: (command) => {
          if (command === "paplay" || command === "canberra-gtk-play") {
            return `/usr/bin/${command}`;
          }
          return null;
        },
        spawnAndWait: async (command) => {
          attempted.push(command);
          return command[0] === "canberra-gtk-play";
        },
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(attempted[0]?.[0]).toBe("paplay");
      expect(attempted[1]?.[0]).toBe("canberra-gtk-play");
      expect(bellCalled).toBe(false);
    });

    test("falls back to terminal bell when no command backend is available", async () => {
      let bellCalled = false;

      const result = await playCompletionSound("error", {
        platform: "linux",
        which: () => null,
        spawnAndWait: async () => false,
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("falls back to bell when internal spawn exits non-zero", async () => {
      let bellCalled = false;

      Bun.spawn = (() => createMockProcess(Promise.resolve(1))) as typeof Bun.spawn;

      const result = await playCompletionSound("warning", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("falls back to bell when internal spawn exited promise rejects", async () => {
      let bellCalled = false;

      Bun.spawn = (() =>
        createMockProcess(Promise.reject(new Error("exit failure")))) as typeof Bun.spawn;

      const result = await playCompletionSound("warning", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("kills timed-out process and falls back to bell", async () => {
      let bellCalled = false;
      let killed = false;

      Bun.spawn = (() =>
        createMockProcess(Promise.resolve(0), () => {
          killed = true;
        })) as typeof Bun.spawn;
      globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
        const handler = args[0];
        if (typeof handler === "function") {
          handler();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      const result = await playCompletionSound("warning", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(killed).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("falls back to bell when Bun.spawn throws", async () => {
      let bellCalled = false;

      Bun.spawn = (() => {
        throw new Error("spawn unavailable");
      }) as typeof Bun.spawn;

      const result = await playCompletionSound("warning", {
        platform: "darwin",
        which: (command) => (command === "afplay" ? "/usr/bin/afplay" : null),
        writeBell: () => {
          bellCalled = true;
        },
      });

      expect(result.played).toBe(true);
      expect(bellCalled).toBe(true);
    });

    test("returns failure when every backend fails and bell throws", async () => {
      const result = await playCompletionSound("error", {
        platform: "linux",
        which: (command) => (command === "paplay" ? "/usr/bin/paplay" : null),
        spawnAndWait: async () => false,
        writeBell: () => {
          throw new Error("no tty");
        },
      });

      expect(result.played).toBe(false);
      expect(result.reason).toContain("No usable sound backend");
    });
  });
});
