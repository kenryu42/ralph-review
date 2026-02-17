import { describe, expect, test } from "bun:test";
import type { ColorLevel } from "@/terminal/theme";
import {
  bold,
  colorize,
  dim,
  getColorLevel,
  hex,
  isRich,
  stripAnsi,
  theme,
} from "@/terminal/theme";

type ColorEnvKey =
  | "NO_COLOR"
  | "FORCE_COLOR"
  | "CI"
  | "GITHUB_ACTIONS"
  | "GITLAB_CI"
  | "CIRCLECI"
  | "TRAVIS"
  | "DRONE"
  | "BUILDKITE"
  | "APPVEYOR"
  | "TERM"
  | "WT_SESSION"
  | "TERM_PROGRAM"
  | "COLORTERM";

type RuntimeOverrides = {
  env?: Partial<Record<ColorEnvKey, string | undefined>>;
  platform?: NodeJS.Platform;
  isTTY?: boolean;
};

const COLOR_ENV_KEYS: readonly ColorEnvKey[] = [
  "NO_COLOR",
  "FORCE_COLOR",
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "DRONE",
  "BUILDKITE",
  "APPVEYOR",
  "TERM",
  "WT_SESSION",
  "TERM_PROGRAM",
  "COLORTERM",
];

function withRuntimeOverrides<T>(overrides: RuntimeOverrides, callback: () => T): T {
  const originalEnv = new Map<ColorEnvKey, string | undefined>();
  for (const key of COLOR_ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }

  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const originalStdoutIsTTYDescriptor = process.stdout
    ? Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    : undefined;

  try {
    if (overrides.env) {
      for (const [key, value] of Object.entries(overrides.env) as Array<
        [ColorEnvKey, string | undefined]
      >) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }

    if (overrides.platform) {
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: overrides.platform,
        writable: true,
      });
    }

    if (process.stdout && overrides.isTTY !== undefined) {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: overrides.isTTY,
        writable: true,
      });
    }

    return callback();
  } finally {
    for (const key of COLOR_ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }

    if (process.stdout) {
      if (originalStdoutIsTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }
  }
}

describe("terminal/theme detectColorLevel", () => {
  test("returns a valid ColorLevel type", () => {
    const level: ColorLevel = getColorLevel();
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(3);
  });

  test("uses FORCE_COLOR numeric value with clamping", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "-1" },
        isTTY: false,
        platform: "darwin",
      },
      () => {
        expect(getColorLevel()).toBe(0);
      }
    );

    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "2" },
        isTTY: false,
        platform: "darwin",
      },
      () => {
        expect(getColorLevel()).toBe(2);
        expect(isRich()).toBe(true);
      }
    );

    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "99" },
        isTTY: false,
        platform: "darwin",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );
  });

  test("FORCE_COLOR non-numeric enables truecolor", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "always" },
        isTTY: false,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );
  });

  test("FORCE_COLOR takes precedence over NO_COLOR", () => {
    withRuntimeOverrides(
      {
        env: {
          FORCE_COLOR: "1",
          NO_COLOR: "1",
        },
        isTTY: false,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(1);
        expect(isRich()).toBe(false);
      }
    );
  });

  test("NO_COLOR disables colors when FORCE_COLOR is not set", () => {
    withRuntimeOverrides(
      {
        env: { NO_COLOR: "1" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(0);
      }
    );
  });

  test("returns no color for non-TTY outside CI", () => {
    withRuntimeOverrides(
      {
        env: {},
        isTTY: false,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(0);
      }
    );
  });

  test("returns no color for dumb terminal even in CI", () => {
    withRuntimeOverrides(
      {
        env: {
          CI: "1",
          TERM: "dumb",
        },
        isTTY: false,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(0);
      }
    );
  });

  test("detects truecolor from COLORTERM", () => {
    withRuntimeOverrides(
      {
        env: { COLORTERM: "truecolor" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );

    withRuntimeOverrides(
      {
        env: { COLORTERM: "24bit" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );
  });

  test("detects 256-color terminals from TERM", () => {
    withRuntimeOverrides(
      {
        env: { TERM: "xterm-256color" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(2);
      }
    );
  });

  test("detects basic color terminals from TERM", () => {
    withRuntimeOverrides(
      {
        env: { TERM: "ansi" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(1);
      }
    );

    withRuntimeOverrides(
      {
        env: { TERM: "xterm" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(1);
      }
    );
  });

  test("falls back to basic color for generic TTY", () => {
    withRuntimeOverrides(
      {
        env: {},
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(1);
      }
    );
  });

  test("falls through TERM parsing when terminal lacks color hints", () => {
    withRuntimeOverrides(
      {
        env: { TERM: "vt100" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(getColorLevel()).toBe(1);
      }
    );
  });

  test("handles Windows terminal capabilities", () => {
    withRuntimeOverrides(
      {
        env: { WT_SESSION: "abc" },
        isTTY: true,
        platform: "win32",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );

    withRuntimeOverrides(
      {
        env: { TERM_PROGRAM: "vscode" },
        isTTY: true,
        platform: "win32",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );

    withRuntimeOverrides(
      {
        env: { COLORTERM: "truecolor" },
        isTTY: true,
        platform: "win32",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );

    withRuntimeOverrides(
      {
        env: { TERM: "xterm" },
        isTTY: true,
        platform: "win32",
      },
      () => {
        expect(getColorLevel()).toBe(3);
      }
    );

    withRuntimeOverrides(
      {
        env: {},
        isTTY: true,
        platform: "win32",
      },
      () => {
        expect(getColorLevel()).toBe(1);
      }
    );
  });
});

describe("terminal/theme color formatting", () => {
  test("hex returns passthrough function for invalid hex", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "3" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        const invalid = hex("not-a-hex");
        expect(invalid("plain")).toBe("plain");
      }
    );
  });

  test("hex supports values without # prefix", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "3" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("FF0000")("value")).toBe("\x1B[38;2;255;0;0mvalue\x1B[0m");
      }
    );
  });

  test("hex uses truecolor formatting at level 3", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "3" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("#112233")("text")).toBe("\x1B[38;2;17;34;51mtext\x1B[0m");
      }
    );
  });

  test("hex uses ANSI-256 formatting at level 2", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "2" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("#FF0000")("text")).toBe("\x1B[38;5;196mtext\x1B[0m");
      }
    );
  });

  test("hex ANSI-256 conversion handles grayscale low/high/mid", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "2" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("#000000")("low")).toBe("\x1B[38;5;16mlow\x1B[0m");
        expect(hex("#FFFFFF")("high")).toBe("\x1B[38;5;231mhigh\x1B[0m");
        expect(hex("#808080")("mid")).toBe("\x1B[38;5;244mmid\x1B[0m");
      }
    );
  });

  test("hex falls back to plain text at level 1", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "1" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("#112233")("text")).toBe("text");
      }
    );
  });

  test("hex falls back to plain text at level 0", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "0" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(hex("#112233")("text")).toBe("text");
      }
    );
  });

  test("heading composes bold and truecolor at level 3", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "3" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(theme.heading("Heading")).toBe("\x1B[1m\x1B[38;2;255;200;0mHeading\x1B[0m");
      }
    );
  });

  test("heading composes bold and ANSI-256 at level 2", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "2" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(theme.heading("Heading")).toBe("\x1B[1;38;5;220mHeading\x1B[0m");
      }
    );
  });

  test("heading is plain at level 0", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "0" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(theme.heading("Heading")).toBe("Heading");
      }
    );
  });

  test("theme color functions preserve plain text content", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "2" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        const text = "hello\nworld\ttab";

        expect(stripAnsi(theme.accent(text))).toBe(text);
        expect(stripAnsi(theme.accentBright(text))).toBe(text);
        expect(stripAnsi(theme.accentDim(text))).toBe(text);
        expect(stripAnsi(theme.info(text))).toBe(text);
        expect(stripAnsi(theme.success(text))).toBe(text);
        expect(stripAnsi(theme.warn(text))).toBe(text);
        expect(stripAnsi(theme.error(text))).toBe(text);
        expect(stripAnsi(theme.muted(text))).toBe(text);
        expect(stripAnsi(theme.command(text))).toBe(text);
        expect(stripAnsi(theme.option(text))).toBe(text);
      }
    );
  });
});

describe("terminal/theme utilities", () => {
  test("bold and dim apply styles when color is enabled", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "1" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(bold("bold text")).toBe("\x1B[1mbold text\x1B[0m");
        expect(dim("dim text")).toBe("\x1B[2mdim text\x1B[0m");
      }
    );
  });

  test("bold and dim return plain text when color is disabled", () => {
    withRuntimeOverrides(
      {
        env: { FORCE_COLOR: "0" },
        isTTY: true,
        platform: "linux",
      },
      () => {
        expect(bold("bold text")).toBe("bold text");
        expect(dim("dim text")).toBe("dim text");
      }
    );
  });

  test("colorize applies or bypasses formatter based on rich flag", () => {
    const formatter = (text: string) => `\x1B[31m${text}\x1B[0m`;

    expect(colorize(true, formatter, "test")).toBe("\x1B[31mtest\x1B[0m");
    expect(colorize(false, formatter, "test")).toBe("test");
  });

  test("stripAnsi removes escape codes and preserves plain text", () => {
    expect(stripAnsi("\x1B[31mred\x1B[0m \x1B[32mgreen\x1B[0m")).toBe("red green");
    expect(stripAnsi("\x1B[1;38;2;255;90;45mbold colored\x1B[0m")).toBe("bold colored");
    expect(stripAnsi("no colors here")).toBe("no colors here");
    expect(stripAnsi("")).toBe("");
  });
});
