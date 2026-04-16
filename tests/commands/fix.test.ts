import { describe, expect, test } from "bun:test";
import {
  type FixCommandDeps,
  parseFixCommandOptions,
  runFix,
  runFixForeground,
} from "@/commands/fix";
import type {
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import { createConfig } from "../helpers/diagnostics";

const EXIT_PREFIX = "__FORCED_EXIT__:";

function createFinding(
  id: StoredFinding["id"],
  priority: StoredFinding["priority"]
): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:10:12`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

function createArtifact(): FindingsArtifact {
  return {
    artifactVersion: 1,
    sessionId: "session-123",
    projectPath: "/repo/project",
    logPath: "/tmp/session-123.jsonl",
    reviewedSnapshotRef: "snapshot-ref",
    reviewedSnapshotPath: "/tmp/reviewed",
    sourceFingerprint: "fingerprint-1",
    findings: [createFinding("F001", "P0"), createFinding("F002", "P1")],
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

interface FixHarness {
  deps: Partial<FixCommandDeps>;
  infos: string[];
  successes: string[];
  warnings: string[];
  errors: string[];
  notes: Array<{ message: string; title: string }>;
  exits: number[];
  createSessionCalls: Array<{ sessionName: string; command: string }>;
  createSessionStateCalls: Array<{ projectPath: string; sessionName: string; options: unknown }>;
  updateSessionStateCalls: Array<{
    projectPath: string;
    sessionId: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }>;
  removeSessionStateCalls: Array<{
    projectPath: string;
    sessionId: string;
    expectedSessionId?: string;
  }>;
  promptCalls: FindingsArtifact[];
  runFixSessionCalls: Array<Record<string, unknown>>;
  touchHeartbeatCalls: Array<{ projectPath: string; sessionId: string }>;
  clearIntervalCalls: number[];
}

function createFixHarness(
  overrides: {
    artifact?: FindingsArtifact | null;
    promptSelection?: string[] | null;
    createSessionError?: Error;
    isTTY?: boolean;
    runFixSessionResult?: Awaited<ReturnType<FixCommandDeps["runFixSession"]>>;
    runFixSessionImpl?: FixCommandDeps["runFixSession"];
    sessionStateData?: {
      schemaVersion: 2;
      sessionId: string;
      sessionName: string;
      startTime: number;
      lastHeartbeat: number;
      pid: number;
      projectPath: string;
      branch: string;
      state: "pending" | "running";
      mode: "background" | "foreground";
      sessionPath?: string;
      currentAgent?: "reviewer" | "fixer" | "code-simplifier" | null;
    } | null;
  } = {}
): FixHarness {
  const infos: string[] = [];
  const successes: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const notes: Array<{ message: string; title: string }> = [];
  const exits: number[] = [];
  const createSessionCalls: Array<{ sessionName: string; command: string }> = [];
  const createSessionStateCalls: Array<{
    projectPath: string;
    sessionName: string;
    options: unknown;
  }> = [];
  const updateSessionStateCalls: Array<{
    projectPath: string;
    sessionId: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }> = [];
  const removeSessionStateCalls: Array<{
    projectPath: string;
    sessionId: string;
    expectedSessionId?: string;
  }> = [];
  const promptCalls: FindingsArtifact[] = [];
  const runFixSessionCalls: Array<Record<string, unknown>> = [];
  const touchHeartbeatCalls: Array<{ projectPath: string; sessionId: string }> = [];
  const clearIntervalCalls: number[] = [];

  let nowTick = 10_000;
  const artifact = overrides.artifact === undefined ? createArtifact() : overrides.artifact;
  const resultArtifact = createArtifact();
  const selectedFinding = resultArtifact.findings[0];
  const unselectedFinding = resultArtifact.findings[1];
  if (!selectedFinding || !unselectedFinding) {
    throw new Error("expected default findings to exist");
  }

  return {
    infos,
    successes,
    warnings,
    errors,
    notes,
    exits,
    createSessionCalls,
    createSessionStateCalls,
    updateSessionStateCalls,
    removeSessionStateCalls,
    promptCalls,
    runFixSessionCalls,
    touchHeartbeatCalls,
    clearIntervalCalls,
    deps: {
      loadConfig: async () => createConfig(),
      loadFindingsArtifactBySessionId: async () => artifact,
      promptForSelection: async (nextArtifact) => {
        promptCalls.push(nextArtifact);
        return (overrides.promptSelection as FindingId[] | null | undefined) ?? null;
      },
      runFixSession:
        overrides.runFixSessionImpl ??
        (async (_config, options) => {
          runFixSessionCalls.push(options as unknown as Record<string, unknown>);
          return (
            overrides.runFixSessionResult ?? {
              phase: "complete",
              sessionStatus: "completed",
              reviewOutcome: "fixed-selected",
              reason: "Applied selected findings.",
              artifact: resultArtifact,
              selection: {
                selectedFindingIds: ["F001"],
                selectedFindings: [selectedFinding],
              },
              fixResults: [],
              unresolvedSelectedFindings: [],
              unselectedFindings: [unselectedFinding],
              handoffStatus: "pending-apply",
              handoffUpdatedAt: 20_001,
              commitSha: "commit-sha-1",
            }
          );
        }),
      isTTY: () => overrides.isTTY ?? false,
      isTmuxInstalled: () => true,
      getTmuxInstallHint: () => "brew install tmux",
      getGitBranch: async () => "main",
      createSession: async (sessionName, command) => {
        createSessionCalls.push({ sessionName, command });
        if (overrides.createSessionError) {
          throw overrides.createSessionError;
        }
      },
      generateSessionName: () => "rr-project-fix",
      createSessionState: async (_storageRoot, projectPath, sessionName, options) => {
        createSessionStateCalls.push({ projectPath, sessionName, options });
      },
      readSessionState: async () => overrides.sessionStateData ?? null,
      updateSessionState: async (_storageRoot, projectPath, sessionId, updates, options) => {
        updateSessionStateCalls.push({
          projectPath,
          sessionId,
          updates: updates as Record<string, unknown>,
          expectedSessionId: options?.expectedSessionId,
        });
        return true;
      },
      removeSessionState: async (_storageRoot, projectPath, sessionId, options) => {
        removeSessionStateCalls.push({
          projectPath,
          sessionId,
          expectedSessionId: options?.expectedSessionId,
        });
        return true;
      },
      touchSessionHeartbeat: async (_storageRoot, projectPath, sessionId) => {
        touchHeartbeatCalls.push({ projectPath, sessionId });
        return true;
      },
      now: () => {
        nowTick += 1;
        return nowTick;
      },
      setInterval: () => setTimeout(() => {}, 0),
      clearInterval: (handle) => {
        clearIntervalCalls.push(handle as unknown as number);
      },
      cwd: () => "/repo/project",
      env: {},
      pid: 4242,
      execPath: "/bun/bin/bun",
      logInfo: (message) => {
        infos.push(message);
      },
      logSuccess: (message) => {
        successes.push(message);
      },
      logWarn: (message) => {
        warnings.push(message);
      },
      logError: (message) => {
        errors.push(message);
      },
      note: (message, title) => {
        notes.push({ message, title });
      },
      exit: (code) => {
        exits.push(code);
        throw new Error(`${EXIT_PREFIX}${code}`);
      },
    },
  };
}

async function captureExit(run: () => Promise<void>): Promise<number | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(EXIT_PREFIX)) {
      return Number.parseInt(error.message.slice(EXIT_PREFIX.length), 10);
    }

    throw error;
  }
}

describe("fix command", () => {
  test("parses repeated priority flags as a union", () => {
    const options = parseFixCommandOptions([
      "--session",
      "session-123",
      "--priority",
      "P0",
      "--priority",
      "P2",
    ]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        priorities: ["P0", "P2"],
      },
    });
  });

  test("parses repeated id flags as a union", () => {
    const options = parseFixCommandOptions([
      "--session",
      "session-123",
      "--id",
      "F001",
      "--id",
      "F003",
    ]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        ids: ["F001", "F003"],
      },
    });
  });

  test("parses all selector mode", () => {
    const options = parseFixCommandOptions(["--session", "session-123", "--all"]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        all: true,
      },
    });
  });

  test("requires a session id", () => {
    expect(() => parseFixCommandOptions(["--all"])).toThrow(
      "fix: missing required argument <session>"
    );
  });

  test("rejects mixed selector modes", () => {
    expect(() =>
      parseFixCommandOptions(["--session", "session-123", "--all", "--priority", "P0"])
    ).toThrow("Selector modes are mutually exclusive");
  });

  test("launches a tmux-backed fixer session for explicit selectors", async () => {
    const harness = createFixHarness();

    await runFix(
      ["--session", "session-123", "--priority", "P0", "--priority", "P1"],
      harness.deps
    );

    expect(harness.createSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionName: "rr-project-fix",
        options: expect.objectContaining({
          branch: "main",
          sessionId: "session-123",
          state: "pending",
          mode: "background",
          lastHeartbeat: 10001,
          sessionPath: "/tmp/session-123.jsonl",
          currentPhase: "selection",
          phase: "selection",
          sessionStatus: "running",
          selectedFindingIds: undefined,
        }),
      },
    ]);
    expect(harness.createSessionCalls).toHaveLength(1);
    expect(harness.createSessionCalls[0]?.command).toContain(
      "_fix-foreground --session session-123 --priority P0 --priority P1"
    );
    expect(harness.successes).toEqual(["Fix started in background session: rr-project-fix"]);
  });

  test("prompts locally before launch and passes explicit ids to the foreground fixer", async () => {
    const harness = createFixHarness({
      isTTY: true,
      promptSelection: ["F002", "F001"],
    });

    await runFix(["--session", "session-123"], harness.deps);

    expect(harness.promptCalls).toHaveLength(1);
    expect(harness.createSessionCalls).toHaveLength(1);
    expect(harness.createSessionCalls[0]?.command).toContain(
      "_fix-foreground --session session-123 --id F001 --id F002"
    );
  });

  test("fails with guidance when no selector is provided in a non-interactive terminal", async () => {
    const harness = createFixHarness();

    const exitCode = await captureExit(() => runFix(["--session", "session-123"], harness.deps));

    expect(exitCode).toBe(1);
    expect(harness.errors).toEqual([
      "No selector was provided. Re-run with one of --all, --priority, or --id, or use an interactive terminal.",
    ]);
    expect(harness.createSessionCalls).toEqual([]);
  });

  test("removes recreated session state when tmux startup fails", async () => {
    const harness = createFixHarness({
      createSessionError: new Error("tmux create-session failed"),
    });

    const exitCode = await captureExit(() =>
      runFix(["--session", "session-123", "--all"], harness.deps)
    );

    expect(exitCode).toBe(1);
    expect(harness.removeSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        expectedSessionId: "session-123",
      },
    ]);
  });

  test("runs the foreground fixer with non-interactive selector args and persists final state", async () => {
    const artifact = createArtifact();
    const selectedFinding = artifact.findings[0];
    const unselectedFinding = artifact.findings[1];
    if (!selectedFinding || !unselectedFinding) {
      throw new Error("expected default findings to exist");
    }
    const harness = createFixHarness({
      sessionStateData: {
        schemaVersion: 2,
        sessionId: "session-123",
        sessionName: "rr-project-fix",
        startTime: 1,
        lastHeartbeat: 1,
        pid: 111,
        projectPath: "/repo/project",
        branch: "main",
        state: "pending",
        mode: "background",
        sessionPath: artifact.logPath,
        currentAgent: null,
      },
      runFixSessionImpl: async (_config, options) => {
        harness.runFixSessionCalls.push(options as unknown as Record<string, unknown>);
        const onProgress = options.onProgress;
        if (onProgress) {
          await onProgress({
            currentPhase: "batch-fix",
            phase: "batch-fix",
            sessionStatus: "running",
            currentAgent: "fixer",
            worktreeProjectPath: "/tmp/worktree",
            worktreeBranch: "rr-worktree-session-123-fix",
            selectedFindingIds: ["F001"],
          });
          await onProgress({
            currentPhase: "final-audit",
            phase: "final-audit",
            sessionStatus: "running",
            currentAgent: "reviewer",
            selectedFindingIds: ["F001"],
          });
        }

        return {
          phase: "complete",
          sessionStatus: "completed",
          reviewOutcome: "fixed-selected",
          reason: "Applied selected findings.",
          artifact,
          selection: {
            selectedFindingIds: ["F001"],
            selectedFindings: [selectedFinding],
          },
          fixResults: [],
          audit: {
            resolvedFindingIds: ["F001"],
            unresolvedFindingIds: [],
            regressionFindings: [],
          },
          unresolvedSelectedFindings: [],
          unselectedFindings: [unselectedFinding],
          handoffStatus: "pending-apply",
          handoffUpdatedAt: 20_001,
          commitSha: "commit-sha-1",
        };
      },
    });

    await runFixForeground(["--session", "session-123", "--id", "F001"], {
      ...harness.deps,
      env: {
        RR_PROJECT_PATH: "/repo/project",
        RR_SESSION_ID: "session-123",
        RR_SESSION_PATH: artifact.logPath,
      },
    });

    expect(harness.runFixSessionCalls).toEqual([
      {
        sessionId: "session-123",
        selector: {
          ids: ["F001"],
        },
        isTTY: false,
        onProgress: expect.any(Function),
      },
    ]);
    expect(harness.updateSessionStateCalls[0]?.updates).toMatchObject({
      state: "running",
      currentPhase: "selection",
      phase: "selection",
      sessionStatus: "running",
      currentAgent: null,
      sessionPath: artifact.logPath,
    });
    expect(
      harness.updateSessionStateCalls.some(
        (call) => call.updates.currentPhase === "batch-fix" && call.updates.currentAgent === "fixer"
      )
    ).toBe(true);
    expect(
      harness.updateSessionStateCalls.some(
        (call) =>
          call.updates.currentPhase === "final-audit" && call.updates.currentAgent === "reviewer"
      )
    ).toBe(true);
    expect(harness.updateSessionStateCalls.at(-1)?.updates).toMatchObject({
      state: "completed",
      phase: "complete",
      reviewOutcome: "fixed-selected",
      handoffStatus: "pending-apply",
      commitSha: "commit-sha-1",
      selectedFindingIds: ["F001"],
      latestAudit: {
        resolvedFindingIds: ["F001"],
        unresolvedFindingIds: [],
        regressionFindings: [],
      },
    });
    expect(harness.removeSessionStateCalls).toEqual([
      {
        projectPath: "/repo/project",
        sessionId: "session-123",
        expectedSessionId: "session-123",
      },
    ]);
    expect(harness.clearIntervalCalls).toHaveLength(1);
  });
});
