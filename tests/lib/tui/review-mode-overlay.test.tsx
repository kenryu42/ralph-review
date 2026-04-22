import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { buildReviewRunArgs, ReviewModeOverlay } from "@/lib/tui/dashboard/ReviewModeOverlay";
import type { DefaultReview } from "@/lib/types";

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
    terminalSize: { width: number; height: number } = { width: 100, height: 30 }
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
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  async function emitKey(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
    const sequenceMap: Record<string, string> = {
      down: "\x1B[B",
      up: "\x1B[A",
      escape: "\x1B",
      return: "\r",
      tab: "\t",
      q: "q",
      j: "j",
      k: "k",
    };

    await act(async () => {
      setup.renderer.keyInput.emit(
        "keypress",
        new KeyEvent({
          name,
          sequence: sequenceMap[name] ?? name,
          ctrl: false,
          shift: false,
          meta: false,
          option: false,
          eventType: "press",
          repeated: false,
          source: "raw",
          number: false,
          raw: sequenceMap[name] ?? name,
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

  test("renames the max iterations step to options", async () => {
    const setup = await renderOverlay();

    await emitKey(setup, "return");
    await act(async () => {
      await setup.renderOnce();
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Options");
    expect(frame).not.toContain("Max Iterations");
    expect(frame).toContain("[c] Custom Instruction");
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
    expect(frame).toContain("Custom instruction set.");
    expect(frame).toContain("[c] Edit");
  });

  test("submits custom instructions with uncommitted review from options", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

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
    await emitKey(setup, "tab");
    await emitKey(setup, "down");
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5", "--auto"]]);
  });

  test("submits auto-fix priorities with normalized csv values", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");
    await emitKey(setup, "tab");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "tab");
    await act(async () => {
      await setup.mockInput.typeText("p1,p0");
      await setup.renderOnce();
    });
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted", "--max", "5", "--auto", "--priority", "P0,P1"]]);
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
