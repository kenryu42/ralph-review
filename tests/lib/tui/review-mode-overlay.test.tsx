import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { buildReviewRunArgs, ReviewModeOverlay } from "@/lib/tui/dashboard/ReviewModeOverlay";
import type { DefaultReview } from "@/lib/types";

const CUSTOM_INSTRUCTIONS_PLACEHOLDER_FRAME = "Focus on security boundaries";

function findTextLocation(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n");
  for (const [y, line] of lines.entries()) {
    const x = line.indexOf(text);
    if (x >= 0) {
      return { x, y };
    }
  }

  throw new Error(`Could not find "${text}" in frame:\n${frame}`);
}

describe("buildReviewRunArgs", () => {
  test("returns the uncommitted flag", () => {
    expect(buildReviewRunArgs("uncommitted")).toEqual(["--uncommitted"]);
  });

  test("returns the trimmed base branch", () => {
    expect(buildReviewRunArgs("base", "\n  origin/main  \n")).toEqual(["--base", "origin/main"]);
  });

  test("rejects multiline base branch input", () => {
    expect(() => buildReviewRunArgs("base", "main\nfeature")).toThrow(
      "Base branch must be a single line."
    );
  });

  test("returns the trimmed target commit", () => {
    expect(buildReviewRunArgs("commit", "  abc1234  ")).toEqual(["--commit", "abc1234"]);
  });
});

describe("ReviewModeOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
  let restoreSpawnSync: (() => void) | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }

    restoreSpawnSync?.();
    restoreSpawnSync = null;
  });

  async function renderOverlay(
    props: {
      defaultReview?: DefaultReview;
      onClose?: () => void;
      onSubmit?: (args: string[]) => void;
    } = {},
    terminalSize: { width: number; height: number } = { width: 100, height: 30 },
    inputOptions: { otherModifiersMode?: boolean } = {}
  ) {
    const defaultProps: Parameters<typeof ReviewModeOverlay>[0] = {
      defaultReview: { type: "uncommitted" },
      projectPath: "/tmp/test-project",
      onClose: () => {},
      onSubmit: () => {},
      ...props,
    };

    testSetup = await testRender(createElement(ReviewModeOverlay, defaultProps), {
      width: terminalSize.width,
      height: terminalSize.height,
      ...inputOptions,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  async function emitKey(
    setup: Awaited<ReturnType<typeof testRender>>,
    name: string,
    options: {
      shift?: boolean;
    } = {}
  ) {
    const sequenceMap: Record<string, string> = {
      down: "\x1B[B",
      up: "\x1B[A",
      left: "\x1B[D",
      right: "\x1B[C",
      escape: "\x1B",
      return: "\r",
      space: " ",
      tab: "\t",
      q: "q",
      h: "h",
      j: "j",
      k: "k",
      l: "l",
    };
    const sequence = options.shift && name === "tab" ? "\x1B[Z" : (sequenceMap[name] ?? name);

    await act(async () => {
      setup.renderer.keyInput.emit(
        "keypress",
        new KeyEvent({
          name,
          sequence,
          ctrl: false,
          shift: options.shift ?? false,
          meta: false,
          option: false,
          eventType: "press",
          repeated: false,
          source: "raw",
          number: false,
          raw: sequence,
        })
      );
      await setup.renderOnce();
    });
  }

  function mockGitBranches({
    currentBranch,
    branches,
  }: {
    currentBranch: string;
    branches: string[];
  }) {
    const originalSpawnSync = Bun.spawnSync;

    type SpawnSyncArgs =
      | [command: string[], options?: { cwd?: string; stdout?: "pipe"; stderr?: "pipe" }]
      | [
          options: {
            cmd: string[];
            cwd?: string;
            stdout?: "pipe";
            stderr?: "pipe";
          },
        ];

    Bun.spawnSync = ((...args: SpawnSyncArgs) => {
      const firstArg = args[0];
      const command = Array.isArray(firstArg) ? firstArg : firstArg.cmd;

      if (command[0] === "git" && command[1] === "branch" && command[2] === "--show-current") {
        return {
          exitCode: 0,
          stdout: Buffer.from(currentBranch),
          stderr: Buffer.from(""),
        };
      }

      if (
        command[0] === "git" &&
        command[1] === "branch" &&
        command[2] === "--format=%(refname:short)"
      ) {
        return {
          exitCode: 0,
          stdout: Buffer.from(branches.join("\n")),
          stderr: Buffer.from(""),
        };
      }

      if (Array.isArray(firstArg)) {
        return originalSpawnSync(firstArg, args[1]);
      }

      return originalSpawnSync(firstArg);
    }) as typeof Bun.spawnSync;

    restoreSpawnSync = () => {
      Bun.spawnSync = originalSpawnSync;
    };
  }

  function mockGitCommits(
    commits:
      | {
          shortSha: string;
          subject: string;
        }[]
      | null
  ) {
    const originalSpawnSync = Bun.spawnSync;

    type SpawnSyncArgs =
      | [command: string[], options?: { cwd?: string; stdout?: "pipe"; stderr?: "pipe" }]
      | [
          options: {
            cmd: string[];
            cwd?: string;
            stdout?: "pipe";
            stderr?: "pipe";
          },
        ];

    Bun.spawnSync = ((...args: SpawnSyncArgs) => {
      const firstArg = args[0];
      const command = Array.isArray(firstArg) ? firstArg : firstArg.cmd;

      if (
        command[0] === "git" &&
        command[1] === "log" &&
        command[2] === "--no-color" &&
        command[3] === "--pretty=format:%h%x09%s" &&
        command[4] === "HEAD"
      ) {
        if (commits === null) {
          return {
            exitCode: 1,
            stdout: Buffer.from(""),
            stderr: Buffer.from("git log failed"),
          };
        }

        return {
          exitCode: 0,
          stdout: Buffer.from(
            commits.map((commit) => `${commit.shortSha}\t${commit.subject}`).join("\n")
          ),
          stderr: Buffer.from(""),
        };
      }

      if (Array.isArray(firstArg)) {
        return originalSpawnSync(firstArg, args[1]);
      }

      return originalSpawnSync(firstArg);
    }) as typeof Bun.spawnSync;

    restoreSpawnSync = () => {
      Bun.spawnSync = originalSpawnSync;
    };
  }

  test("submits uncommitted changes immediately by default", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5"]]);
  });

  test("highlights the base branch option when defaultReview is base", async () => {
    const setup = await renderOverlay({
      defaultReview: { type: "base", branch: "main" },
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("▶ Review against base branch");
  });

  test("shows only review scope options in the picker", async () => {
    const setup = await renderOverlay();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Review uncommitted changes");
    expect(frame).toContain("Review against base branch");
    expect(frame).toContain("Review a commit");
    expect(frame).not.toContain("Default review + custom instructions");
  });

  test("supports j and arrow navigation before confirming", async () => {
    mockGitCommits([
      {
        shortSha: "abc1234",
        subject: "fix: tighten review mode selection",
      },
    ]);

    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "j");
    await emitKey(setup, "return");

    await emitKey(setup, "escape");

    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await emitKey(setup, "return");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--commit", "abc1234", "--max", "5"]]);
  });

  test("centers the review run overlay instead of pinning it to the top", async () => {
    const setup = await renderOverlay({}, { width: 100, height: 30 });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    const header = findTextLocation(frame, "Review Run");

    expect(header.y).toBeGreaterThan(5);
    expect(header.y).toBeLessThan(16);
  });

  test("renders the guided options header and preview in wide layout", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Review Run");
    expect(frame).toContain("Target: Uncommitted");
    expect(frame).toContain("Configuration");
    expect(frame).toContain("Run Preview");
    expect(frame).toContain("rr run --uncommitted --max 5");
    expect(frame).toContain("[↑/↓]");
    expect(frame).toContain("navigates");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("starts review");
    expect(frame).not.toContain("Set an upper bound for review/fix cycles in this run.");
    expect(frame).toContain("╔═Review Run");
    expect(frame).toContain("│ Iterations");
    expect(frame).toContain("│ Force Max Iterations");
    expect(frame).toContain("│Target: Uncommitted");

    const configuration = findTextLocation(frame, "Configuration");
    const preview = findTextLocation(frame, "Run Preview");

    expect(preview.y).toBe(configuration.y);
    expect(preview.x).toBeGreaterThan(configuration.x + 10);
  });

  test("stacks the preview below configuration on compact terminals", async () => {
    const setup = await renderOverlay({}, { width: 92, height: 28 });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Run Preview");

    const configuration = findTextLocation(frame, "Configuration");
    const preview = findTextLocation(frame, "Run Preview");

    expect(preview.y).toBeGreaterThan(configuration.y);
  });

  test("shows the compact custom instructions label and default footer helper text", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Custom instructions [C]");
    expect(frame).toContain("[↑/↓]");
    expect(frame).toContain("navigates");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("starts review");
    expect(frame).not.toContain("Status");
    expect(frame).not.toContain("Press [c] to edit");
    expect(frame).not.toContain("Press [Esc] to close.");
    expect(frame).not.toContain("Esc");
    expect(frame).not.toContain("C opens instructions");
  });

  test("shows ctrl enter in the footer while custom instructions is focused", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("[Ctrl+Enter]");
    expect(frame).toContain("starts review");
  });

  test("preserves hidden custom instructions in the options step", async () => {
    const setup = await renderOverlay();

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Custom instructions [C]");
    expect(frame).toContain("Set");
  });

  test("closes blank custom instructions when escape is pressed", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("   ");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Custom instructions [C]");
    expect(frame).not.toContain(CUSTOM_INSTRUCTIONS_PLACEHOLDER_FRAME);
    expect(frame).toContain("[↑/↓]");
    expect(frame).toContain("navigates");
    expect(frame).toContain("[Enter]");
    expect(frame).toContain("starts review");
  });

  test("submits custom instructions with uncommitted review from options", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      { width: 120, height: 30 }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "check security", "--max", "5"]]);
  });

  test("submits auto-fix all from options", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5", "--auto"]]);
  });

  test("submits auto-fix priorities with ordered priority values", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "right");
    await emitKey(setup, "space");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5", "--auto", "--priority", "P0,P1"]]);
  });

  test("submits force max iterations when the force option is enabled", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5", "--force"]]);
  });

  test("shows force in the preview only when enabled", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Force max iterations: Disabled");
    expect(frame).toContain("rr run --uncommitted --max 5");
    expect(frame).not.toContain("--force");

    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await act(async () => {
      await setup.renderOnce();
    });

    frame = setup.captureCharFrame();
    expect(frame).toContain("Force max iterations: Enabled");
    expect(frame).toContain("rr run --uncommitted --max 5 --force");
    expect(frame).toContain("[Space]");
    expect(frame).toContain("toggles force");
  });

  test("resets force max iterations when re-entering options", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "escape");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Force max iterations: Disabled");
    expect(frame).not.toContain("--force");

    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5"]]);
  });

  test("submits force before auto-fix priority options", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "right");
    await emitKey(setup, "space");
    await emitKey(setup, "return");

    expect(submitted).toEqual([
      ["--uncommitted", "--max", "5", "--force", "--auto", "--priority", "P0,P1"],
    ]);
  });

  test("makes the priority row interactive without an extra tab stop", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Priority filter");
    expect(frame).toContain("◉ Auto-fix priorities");
    expect(frame).not.toContain("◉ Auto-fix priorities [Space] to select");
    expect(frame).toContain("▶ ◇ P0");
    expect(frame).toContain("◇ P0");
    expect(frame).toContain("◇ P1");
    expect(frame).toContain("◇ P2");
    expect(frame).toContain("◇ P3");
    expect(frame).toContain("[←/→]");
    expect(frame).toContain("priority cursor");
    expect(frame).toContain("toggles priority");
    expect(frame).not.toContain("P0,P1");
  });

  test("does not toggle priorities when enter is pressed", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      { width: 120, height: 30 }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(submitted).toEqual([]);
    expect(frame).toContain("◇ P0");
    expect(frame).toContain("◇ P1");
    expect(frame).toContain("Select at least one priority");
  });

  test("cycles upward with up arrow in the options step", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      { width: 120, height: 30 }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "up");
    await emitKey(setup, "up");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5"]]);
  });

  test("updates the preview for auto-fix priorities with ordered selected priorities", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "right");
    await emitKey(setup, "space");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("rr run --uncommitted --max 5 --auto --priority P0,P1");
  });

  test("wraps long command previews instead of clipping trailing arguments", async () => {
    const setup = await renderOverlay({}, { width: 82, height: 26 });

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "space");
    await emitKey(setup, "right");
    await emitKey(setup, "space");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    const start = findTextLocation(frame, "rr run --uncommitted");
    const tail = findTextLocation(frame, "priority P0,P1");

    expect(frame).toContain("<custom instructions>");
    expect(frame).toContain("priority P0,P1");
    expect(tail.y).toBeGreaterThan(start.y);
  });

  test("supports h j k and l aliases in the options step", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "j");
    await emitKey(setup, "j");
    await emitKey(setup, "j");
    await emitKey(setup, "j");
    await emitKey(setup, "l");
    await act(async () => {
      await setup.renderOnce();
    });

    let frame = setup.captureCharFrame();
    expect(frame).toContain("◇ P0 ▶ ◇ P1");

    await emitKey(setup, "h");
    await act(async () => {
      await setup.renderOnce();
    });

    frame = setup.captureCharFrame();
    expect(frame).toContain("▶ ◇ P0");

    await emitKey(setup, "k");
    await act(async () => {
      await setup.renderOnce();
    });

    frame = setup.captureCharFrame();
    expect(frame).toContain("◉ Auto-fix all");
  });

  test("uses left and right to move the inline priority cursor without affecting execution mode", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "right");
    await act(async () => {
      await setup.renderOnce();
    });

    let frame = setup.captureCharFrame();
    expect(frame).toContain("◇ P0 ▶ ◇ P1");
    expect(frame).toContain("[←/→]");
    expect(frame).toContain("priority cursor");

    await emitKey(setup, "up");
    await act(async () => {
      await setup.renderOnce();
    });

    frame = setup.captureCharFrame();
    expect(frame).not.toContain("priority cursor");
    expect(frame).toContain("◉ Auto-fix all");
  });

  test("renders the priority helper in the footer only while active", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await act(async () => {
      await setup.renderOnce();
    });

    let frame = setup.captureCharFrame();
    expect(frame).toContain("priority cursor");
    expect(frame).toContain("toggles priority");

    await emitKey(setup, "up");
    await act(async () => {
      await setup.renderOnce();
    });

    frame = setup.captureCharFrame();
    expect(frame).not.toContain("priority cursor");
    expect(frame).not.toContain("toggles priority");
  });

  test("shows a placeholder token for custom instructions in the preview", async () => {
    const setup = await renderOverlay({}, { width: 120, height: 30 });

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("<custom instructions>");
    expect(frame).not.toContain("check security");
  });

  test("does not submit while custom instructions is focused", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      { width: 120, height: 30 }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "return");

    expect(submitted).toEqual([]);
  });

  test("submits multiline custom instructions with ctrl enter while focused", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      { width: 120, height: 30 },
      { otherModifiersMode: true }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "return");
    await act(async () => {
      await setup.mockInput.typeText("check migrations");
      await setup.renderOnce();
    });
    await act(async () => {
      setup.mockInput.pressEnter({ ctrl: true });
      await setup.renderOnce();
    });

    expect(submitted).toEqual([
      ["--uncommitted", "check security\ncheck migrations", "--max", "5"],
    ]);
  });

  test("omits blank custom instructions from uncommitted review submission", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("   ");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5"]]);
  });

  test("submits base review with custom instructions from options", async () => {
    mockGitBranches({
      currentBranch: "new-review-flow",
      branches: ["main", "release"],
    });

    const submitted: string[][] = [];
    const setup = await renderOverlay({
      defaultReview: { type: "base", branch: "main" },
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check migrations");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--base", "main", "check migrations", "--max", "5"]]);
  });

  test("supports j and k navigation in the branch picker", async () => {
    mockGitBranches({
      currentBranch: "new-review-flow",
      branches: ["main", "release"],
    });

    const submitted: string[][] = [];
    const setup = await renderOverlay({
      defaultReview: { type: "base", branch: "main" },
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "j");
    await emitKey(setup, "return");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--base", "release", "--max", "5"]]);
  });

  test("submits commit review with custom instructions from options", async () => {
    mockGitCommits([
      {
        shortSha: "abc1234",
        subject: "fix: tighten review mode selection",
      },
    ]);

    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await emitKey(setup, "return");
    await emitKey(setup, "c");
    await act(async () => {
      await setup.mockInput.typeText("check logging");
      await setup.renderOnce();
    });
    await emitKey(setup, "escape");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--commit", "abc1234", "check logging", "--max", "5"]]);
  });

  test("supports j and k navigation in the commit picker", async () => {
    mockGitCommits([
      {
        shortSha: "abc1234",
        subject: "fix: tighten review mode selection",
      },
      {
        shortSha: "def5678",
        subject: "feat: add overlay navigation coverage",
      },
    ]);

    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await emitKey(setup, "j");
    await emitKey(setup, "return");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--commit", "def5678", "--max", "5"]]);
  });

  test("closes the picker when q is pressed", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    await emitKey(setup, "q");

    expect(closeCount).toBe(1);
  });

  test("shows the current repo branch description for base branch options", async () => {
    mockGitBranches({
      currentBranch: "new-review-flow",
      branches: ["main", "release"],
    });

    const setup = await renderOverlay({
      defaultReview: { type: "base", branch: "main" },
    });

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Current: new-review-flow");
    expect(frame).not.toContain("Local branch");
    expect(frame).not.toContain("Type manually...");
  });

  test("shows commit message names and short sha descriptions for target commit options", async () => {
    mockGitCommits([
      {
        shortSha: "0d28f568",
        subject: "fix(git): clean up session refs if worktree creation fails",
      },
      {
        shortSha: "021559f8",
        subject: "fix(prune): handle missing or non-git project directories during cleanup",
      },
    ]);

    const setup = await renderOverlay();

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("fix(git): clean up session refs if worktree creation fails");
    expect(frame).toContain("0d28f568");
    expect(frame).toContain(
      "fix(prune): handle missing or non-git project directories during cleanup"
    );
    expect(frame).toContain("021559f8");
    expect(frame).not.toContain("Enter the commit SHA or ref to review.");
  });

  test("shows an unavailable state when target commits cannot be listed", async () => {
    mockGitCommits(null);

    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      {
        width: 100,
        height: 14,
      }
    );

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("No commits available.");
    expect(frame).toContain("Commit history could not be determined.");
    expect(frame).not.toContain("Type manually...");
    expect(submitted).toEqual([]);
  });

  test("shows an unavailable state when no alternate base branches exist", async () => {
    mockGitBranches({
      currentBranch: "new-review-flow",
      branches: ["new-review-flow"],
    });

    const submitted: string[][] = [];
    const setup = await renderOverlay(
      {
        defaultReview: { type: "base", branch: "main" },
        onSubmit: (args) => {
          submitted.push(args);
        },
      },
      {
        width: 100,
        height: 14,
      }
    );

    await emitKey(setup, "return");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("No alternate branches available.");
    expect(frame).toContain("Current repo branch: new-review-flow");
    expect(frame).not.toContain("Type manually...");
    expect(submitted).toEqual([]);
  });

  test("keeps the base branch list visible on short terminals", async () => {
    mockGitBranches({
      currentBranch: "new-review-flow",
      branches: ["main", "release"],
    });

    const setup = await renderOverlay(
      {
        defaultReview: { type: "base", branch: "main" },
      },
      {
        width: 100,
        height: 14,
      }
    );

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("main");
    expect(frame).toContain("release");
  });

  test("keeps the target commit list visible on short terminals", async () => {
    mockGitCommits([
      {
        shortSha: "0d28f568",
        subject: "fix(git): clean up session refs if worktree creation fails",
      },
      {
        shortSha: "021559f8",
        subject: "fix(prune): handle missing or non-git project directories during cleanup",
      },
    ]);

    const setup = await renderOverlay(
      {},
      {
        width: 100,
        height: 14,
      }
    );

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("0d28f568");
    expect(frame).toContain("021559f8");
  });
});
