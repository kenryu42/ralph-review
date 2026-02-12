import { describe, expect, test } from "bun:test";
import { playCompletionSound, resolveSoundEnabled } from "@/lib/notify/sound";
import { CONFIG_SCHEMA_URI, CONFIG_VERSION, type Config } from "@/lib/types";

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

describe("sound notifications", () => {
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
