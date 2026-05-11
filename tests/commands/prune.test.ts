import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import type { PruneCommandDeps } from "@/commands/prune";
import { runPrune } from "@/commands/prune";
import { parseCommand } from "@/lib/cli-parser";
import { getProjectWorktreesDir } from "@/lib/logger";
import {
  getFindingsArtifactPath,
  saveFindingsArtifact,
} from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact } from "@/lib/review-workflow/findings/types";
import type { LogEntry, PendingHandoffArtifact } from "@/lib/types";
import {
  createStorageBackedRepo,
  removeStorageBackedRepo,
  runGitIn,
  runGitResult,
} from "../helpers/git";
import {
  createFindingsArtifact,
  createPendingHandoff as createReviewWorkflowPendingHandoff,
  createStoredFinding,
} from "../helpers/review-workflow";

function gitExitCode(repoPath: string, args: string[]): number {
  return runGitResult(repoPath, args).exitCode;
}

function createArtifact(repoPath: string, sessionId: string, updatedAt: string): FindingsArtifact {
  const normalizedSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-");

  return createFindingsArtifact([createStoredFinding("F001", "P1")], {
    sessionId,
    projectPath: repoPath,
    logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
    baselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/baseline`,
    baselineCommitSha: "baseline-sha-123",
    sourceBaselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/source`,
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineFingerprint: "tracked-fingerprint-1",
    updatedAt,
  });
}

async function saveFindingsArtifactWithUpdatedAt(
  storageRoot: string,
  artifact: FindingsArtifact,
  updatedAt: number
): Promise<void> {
  const saved = await saveFindingsArtifact(storageRoot, artifact);
  await Bun.write(
    getFindingsArtifactPath(storageRoot, saved.projectPath, saved.sessionId),
    JSON.stringify({ ...saved, updatedAt: new Date(updatedAt).toISOString() }, null, 2)
  );
}

async function listPendingFromStorage(): Promise<[]> {
  return [];
}

function createPendingHandoff(
  repoPath: string,
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  return createReviewWorkflowPendingHandoff({
    handoffId: overrides.handoffId ?? overrides.sessionId ?? "session-id",
    sessionId: "session-id",
    projectPath: repoPath,
    sourceRepoPath: repoPath,
    logPath: join(repoPath, ".ralph-review", "logs", "session.jsonl"),
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: join(repoPath, ".ralph-review", "handoffs", "session-id.patch"),
    sourceBaselineFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

describe("prune command", () => {
  let storageRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath, storageRoot } = await createStorageBackedRepo(
      "ralph-prune-storage-",
      "ralph-prune-repo-"
    ));
  });

  afterEach(async () => {
    await removeStorageBackedRepo({ repoPath, storageRoot });
  });

  function runPruneTest(args: string[], deps: Partial<PruneCommandDeps> = {}): Promise<void> {
    return runPrune(args, {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      logInfo: () => {},
      logStep: () => {},
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      isTTY: () => true,
      now: () => 1_800_000_000_000,
      ...deps,
    });
  }

  async function expectSessionArtifactAndLog(
    artifact: FindingsArtifact,
    exists: boolean
  ): Promise<void> {
    expect(
      await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, artifact.sessionId)).exists()
    ).toBe(exists);
    expect(await Bun.file(artifact.logPath).exists()).toBe(exists);
  }

  async function savePrunableArtifact(sessionId = "session-applied", writeLog = false) {
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    if (writeLog) {
      await Bun.write(artifact.logPath, "session log\n", { createPath: true });
    }
    return artifact;
  }

  function findHandoffById(handoffs: PendingHandoffArtifact[], handoffId: string) {
    const matched = handoffs.find((handoff) => handoff.handoffId === handoffId);
    if (!matched) {
      throw new Error(`Unknown handoff ${handoffId}`);
    }
    return matched;
  }

  async function runDiscardWithHandoffs(
    args: string[],
    handoffs: PendingHandoffArtifact[],
    deps: Partial<PruneCommandDeps> = {}
  ) {
    const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];
    await runPruneTest(args, {
      listProjectPendingHandoffs: async () => handoffs,
      discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
        discardCalls.push({ projectPath, handoffId });
        return findHandoffById(handoffs, handoffId);
      },
      appendLog: async () => {},
      ...deps,
    });
    return discardCalls;
  }

  test("dry-run lists prunable sessions without deleting files", async () => {
    const sessionId = "session-applied";
    const infos: string[] = [];
    const successes: string[] = [];
    const artifact = await savePrunableArtifact(sessionId, true);

    await runPruneTest(["--dry-run"], {
      logInfo: (message) => infos.push(message),
      logSuccess: (message) => successes.push(message),
    });

    expect(infos).toContain("Found 1 prunable review session.");
    expect(infos.some((message) => message.includes(sessionId))).toBe(true);
    expect(infos.at(-1)).toBe("Run rr prune to delete these artifacts.");
    await expectSessionArtifactAndLog(artifact, true);
    expect(successes).toEqual([]);
  });

  test("bare prune removes prunable session files and refs after TTY confirmation", async () => {
    const sessionId = "session-applied";
    const confirms: string[] = [];
    const successes: string[] = [];
    const artifact = await savePrunableArtifact(sessionId, true);
    runGitIn(repoPath, ["update-ref", artifact.baselineRef, "HEAD"]);
    runGitIn(repoPath, ["update-ref", "refs/ralph-review/sessions/session-applied/final", "HEAD"]);

    await runPruneTest([], {
      logSuccess: (message) => successes.push(message),
      confirm: async (input) => {
        confirms.push(input.message);
        return true;
      },
    });

    await expectSessionArtifactAndLog(artifact, false);
    expect(gitExitCode(repoPath, ["show-ref", "--verify", artifact.baselineRef])).not.toBe(0);
    expect(
      gitExitCode(repoPath, [
        "show-ref",
        "--verify",
        "refs/ralph-review/sessions/session-applied/final",
      ])
    ).not.toBe(0);
    expect(confirms).toEqual(["Delete 1 prunable review session artifact set?"]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("bare prune requires --yes or --dry-run in non-interactive terminals", async () => {
    const sessionId = "session-applied";
    const errors: string[] = [];
    const exits: number[] = [];
    await savePrunableArtifact(sessionId);

    await runPruneTest([], {
      logError: (message) => errors.push(message),
      exit: (code) => exits.push(code),
      isTTY: () => false,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(errors).toEqual([
      "Cannot prune without confirmation in a non-interactive terminal. Re-run with --yes to delete or --dry-run to preview.",
    ]);
    expect(exits).toEqual([1]);
  });

  test.each([
    ["yes", "--yes"],
    ["short yes alias", "-y"],
  ])("%s removes prunable sessions without prompting", async (_name, option) => {
    const sessionId = "session-applied";
    await savePrunableArtifact(sessionId);
    const successes: string[] = [];
    const confirms: string[] = [];

    await runPruneTest([option], {
      logSuccess: (message) => successes.push(message),
      confirm: async (input) => {
        confirms.push(input.message);
        return true;
      },
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(confirms).toEqual([]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("declining confirmation cancels prune without deleting files", async () => {
    const sessionId = "session-applied";
    const infos: string[] = [];
    await savePrunableArtifact(sessionId);

    await runPruneTest([], {
      logInfo: (message) => infos.push(message),
      confirm: async () => false,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(infos.at(-1)).toBe("Prune cancelled. No artifacts were deleted.");
  });

  test("older-than filters the prunable set", async () => {
    const oldSessionId = "session-old";
    const newSessionId = "session-new";
    await saveFindingsArtifactWithUpdatedAt(
      storageRoot,
      createArtifact(repoPath, oldSessionId, "2026-01-01T00:00:00.000Z"),
      1_700_000_000_000
    );
    await saveFindingsArtifactWithUpdatedAt(
      storageRoot,
      createArtifact(repoPath, newSessionId, "2026-04-10T00:00:00.000Z"),
      1_799_000_000_000
    );

    const infos: string[] = [];
    await runPruneTest(["--older-than", "14d", "--dry-run"], {
      logInfo: (message) => infos.push(message),
    });

    expect(infos.some((message) => message.includes(oldSessionId))).toBe(true);
    expect(infos.some((message) => message.includes(newSessionId))).toBe(false);
  });

  test("force session prune removes the targeted session", async () => {
    const sessionId = "session-force";
    const artifact = await savePrunableArtifact(sessionId, true);

    await runPruneTest(["--session", sessionId, "--force", "--yes"]);

    await expectSessionArtifactAndLog(artifact, false);
  });

  test("force session prune removes orphaned worktree-only sessions", async () => {
    const sessionId = "session-orphan";
    const worktreesDir = getProjectWorktreesDir(storageRoot, repoPath);
    const worktreeEntry = `${sessionId}-1700000000000-deadbeef`;
    const orphanWorktreeDir = join(worktreesDir, worktreeEntry);
    await Bun.write(join(orphanWorktreeDir, ".keep"), "orphan\n", { createPath: true });

    const errors: string[] = [];
    const exits: number[] = [];
    const successes: string[] = [];

    await runPruneTest(["--session", sessionId, "--force", "--yes"], {
      logSuccess: (message) => successes.push(message),
      logError: (message) => errors.push(message),
      exit: (code) => exits.push(code),
    });

    const remainingEntries = await readdir(worktreesDir).catch(() => []);
    expect(remainingEntries.some((entry) => entry.startsWith(sessionId))).toBe(false);
    expect(errors).toEqual([]);
    expect(exits).toEqual([]);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("all-projects skips missing project directories instead of aborting", async () => {
    const missingProjectPath = await mkdtemp(join(tmpdir(), "ralph-prune-missing-project-"));
    await rm(missingProjectPath, { recursive: true, force: true });

    const sessionId = "session-missing-project";
    await saveFindingsArtifact(
      storageRoot,
      createArtifact(missingProjectPath, sessionId, "2026-01-01T00:00:00.000Z")
    );

    const infos: string[] = [];
    const successes: string[] = [];
    await expect(
      runPruneTest(["--all-projects", "--dry-run"], {
        logInfo: (message) => infos.push(message),
        logSuccess: (message) => successes.push(message),
      })
    ).resolves.toBeUndefined();

    expect(infos.some((message) => message.includes(sessionId))).toBe(true);
    expect(successes).toEqual([]);
  });

  test("prune continues cleanup when a recorded project path is no longer a git repository", async () => {
    const nonGitProjectPath = await mkdtemp(join(tmpdir(), "ralph-prune-nongit-project-"));
    const sessionId = "session-non-git";
    const artifact = createArtifact(nonGitProjectPath, sessionId, "2026-01-01T00:00:00.000Z");
    const artifactPath = getFindingsArtifactPath(storageRoot, nonGitProjectPath, sessionId);
    await saveFindingsArtifact(storageRoot, artifact);

    const successes: string[] = [];
    await expect(
      runPruneTest(["--all-projects", "--yes"], {
        logSuccess: (message) => successes.push(message),
      })
    ).resolves.toBeUndefined();

    expect(await Bun.file(artifactPath).exists()).toBe(false);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
    await rm(nonGitProjectPath, { recursive: true, force: true });
  });

  describe("discard mode", () => {
    test("rejects conflicting dry-run and yes options", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPruneTest(["--dry-run", "--yes"], {
        logError: (message) => errors.push(message),
        exit: (code) => exits.push(code),
      });

      expect(errors).toEqual([
        "Cannot combine --dry-run and --yes. Choose one mode and try again.",
      ]);
      expect(exits).toEqual([1]);
    });

    test("prints info when there are no pending handoffs", async () => {
      const infos: string[] = [];
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];

      await runPruneTest(["--discard"], {
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          throw new Error("discardPendingHandoff should not be called");
        },
        appendLog: async () => {},
        logInfo: (message) => infos.push(message),
      });

      expect(infos).toEqual(["No pending review handoffs for current working directory."]);
      expect(discardCalls).toEqual([]);
    });

    test("discards the selected pending handoff", async () => {
      const handoff = createPendingHandoff(repoPath);
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];
      const appendCalls: Array<{ logPath: string; entry: LogEntry }> = [];
      const steps: string[] = [];
      const successes: string[] = [];

      await runPruneTest(["--discard"], {
        listProjectPendingHandoffs: async () => [handoff],
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          return handoff;
        },
        appendLog: async (logPath, entry) => {
          appendCalls.push({ logPath, entry });
        },
        logSuccess: (message) => successes.push(message),
        logStep: (message) => steps.push(message),
      });

      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "session-id" }]);
      expect(steps).toEqual(["Discarding handoff: session-id"]);
      expect(successes).toEqual(["Review handoff discarded."]);
      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]?.logPath).toBe(handoff.logPath);
      expect(appendCalls[0]?.entry).toMatchObject({
        type: "handoff",
        timestamp: 1_800_000_000_000,
        handoffId: "session-id",
        handoffStatus: "discarded",
        commitSha: "commit-sha-1",
      });
    });

    test("accepts a unique session id prefix", async () => {
      const handoffs = [
        createPendingHandoff(repoPath, { handoffId: "handoff-a", sessionId: "session-alpha" }),
        createPendingHandoff(repoPath, { handoffId: "handoff-b", sessionId: "session-beta" }),
      ];
      const discardCalls = await runDiscardWithHandoffs(
        ["--discard", "--session", "session-a"],
        handoffs,
        {
          isTTY: () => false,
        }
      );

      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "handoff-a" }]);
    });

    test("errors when the session selector is blank", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPruneTest(["--discard", "--session", "   "], {
        listProjectPendingHandoffs: async () => [createPendingHandoff(repoPath)],
        logError: (message) => errors.push(message),
        exit: (code) => exits.push(code),
      });

      expect(errors).toEqual(["Session selector cannot be empty."]);
      expect(exits).toEqual([1]);
    });

    test("errors when the session selector does not match any pending handoff", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPruneTest(["--discard", "--session", "session-z"], {
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { sessionId: "session-alpha" }),
        ],
        logError: (message) => errors.push(message),
        exit: (code) => exits.push(code),
      });

      expect(errors).toEqual([
        'No pending review handoff matches "session-z" in the current project.',
      ]);
      expect(exits).toEqual([1]);
    });

    test("errors when the session selector matches multiple prefixes", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPruneTest(["--discard", "--session", "session-a"], {
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { sessionId: "session-alpha" }),
          createPendingHandoff(repoPath, { sessionId: "session-atom" }),
        ],
        logError: (message) => errors.push(message),
        exit: (code) => exits.push(code),
      });

      expect(errors).toEqual([
        'Session selector "session-a" is ambiguous for the current project.',
      ]);
      expect(exits).toEqual([1]);
    });

    test("prompts when multiple pending handoffs exist in an interactive terminal", async () => {
      const handoffs = [
        createPendingHandoff(repoPath, { handoffId: "handoff-alpha", sessionId: "session-alpha" }),
        createPendingHandoff(repoPath, { handoffId: "handoff-beta", sessionId: "session-beta" }),
      ];
      const selectMessages: string[] = [];
      const discardCalls = await runDiscardWithHandoffs(["--discard"], handoffs, {
        select: async (input) => {
          selectMessages.push(input.message);
          return "handoff-beta";
        },
        isCancel: () => false,
      });

      expect(selectMessages).toEqual(["Choose a review handoff to discard"]);
      expect(discardCalls).toEqual([{ projectPath: repoPath, handoffId: "handoff-beta" }]);
    });

    test("returns without discarding when interactive selection is cancelled", async () => {
      const discardCalls: Array<{ projectPath: string; handoffId: string }> = [];
      const successes: string[] = [];

      await runPruneTest(["--discard"], {
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { handoffId: "handoff-alpha" }),
          createPendingHandoff(repoPath, { handoffId: "handoff-beta" }),
        ],
        discardPendingHandoff: async (_storageRoot, projectPath, handoffId) => {
          discardCalls.push({ projectPath, handoffId });
          return createPendingHandoff(repoPath);
        },
        appendLog: async () => {},
        logSuccess: (message) => successes.push(message),
        select: async () => "__CANCEL__",
        isCancel: (value) => value === "__CANCEL__",
      });

      expect(discardCalls).toEqual([]);
      expect(successes).toEqual([]);
    });

    test("errors when multiple pending handoffs exist in a non-interactive terminal", async () => {
      const errors: string[] = [];
      const exits: number[] = [];

      await runPruneTest(["--discard"], {
        listProjectPendingHandoffs: async () => [
          createPendingHandoff(repoPath, { handoffId: "handoff-alpha" }),
          createPendingHandoff(repoPath, { handoffId: "handoff-beta" }),
        ],
        logError: (message) => errors.push(message),
        exit: (code) => exits.push(code),
        isTTY: () => false,
      });

      expect(errors).toEqual([
        "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
      ]);
      expect(exits).toEqual([1]);
    });

    test("rejects cleanup options in discard mode", async () => {
      const scenarios = [
        ["--discard", "--dry-run"],
        ["--discard", "--yes"],
        ["--discard", "--force"],
        ["--discard", "--older-than", "14d"],
        ["--discard", "--all-projects"],
      ];

      for (const args of scenarios) {
        const errors: string[] = [];
        const exits: number[] = [];

        await runPruneTest(args, {
          listProjectPendingHandoffs: listPendingFromStorage,
          logError: (message) => errors.push(message),
          exit: (code) => exits.push(code),
        });

        expect(errors).toEqual([
          "--discard can only be combined with --session. Remove cleanup options and try again.",
        ]);
        expect(exits).toEqual([1]);
      }
    });
  });
});
