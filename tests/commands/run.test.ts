import { describe, expect, mock, test } from "bun:test";
import { getCommandDef } from "@/cli";
import {
  classifyRunCompletion,
  createRunRuntime,
  formatRunAgentsNote,
  getDynamicProbeAgents,
  parseSoundOverride,
  type RunOptions,
  type RunRuntimeOverrides,
  resolveRunSimplifierEnabled,
  resolveRunSoundOverride,
  runForeground,
  startReview,
} from "@/commands/run";
import { type CommandDef, parseCommand } from "@/lib/cli-parser";
import { collectIssueItems as collectIssueItemsFromDiagnostics } from "@/lib/diagnostics";
import type { DiagnosticItem, DiagnosticsReport } from "@/lib/diagnostics/types";
import type { CycleResult } from "@/lib/engine";
import type { SessionState } from "@/lib/session-state";
import type { Config } from "@/lib/types";
import { createCapabilities, createConfig } from "../helpers/diagnostics";

const EXIT_PREFIX = "__FORCED_EXIT__:";

function createCycleResult(overrides: Partial<CycleResult> = {}): CycleResult {
  return {
    success: true,
    finalStatus: "completed",
    reviewOutcome: "clean",
    iterations: 2,
    reason: "No issues found - code is clean",
    sessionPath: "/tmp/session",
    ...overrides,
  };
}

function createDiagnosticsReport(
  items: DiagnosticItem[] = [],
  config: Config | null = createConfig()
): DiagnosticsReport {
  return {
    context: "run",
    items,
    hasErrors: items.some((item) => item.severity === "error"),
    hasWarnings: items.some((item) => item.severity === "warning"),
    capabilitiesByAgent: createCapabilities(),
    generatedAt: new Date().toISOString(),
    config,
  };
}

function createLockData(sessionId = "lock-session-id"): SessionState {
  return {
    schemaVersion: 2,
    sessionId,
    sessionName: "rr-project-main",
    startTime: 1,
    lastHeartbeat: 1,
    pid: 123,
    projectPath: "/repo/project",
    branch: "main",
    state: "pending",
    mode: "background",
    currentAgent: null,
  };
}

interface RunHarnessOptions {
  runValues?: RunOptions;
  foregroundValues?: {
    max?: number;
    force?: boolean;
    simplifier?: boolean;
  };
  parseErrorFor?: Array<"run" | "_run-foreground">;
  commandDefs?: {
    run?: CommandDef;
    foreground?: CommandDef;
  };
  loadConfigResults?: Array<Config | null>;
  diagnostics?: DiagnosticsReport;
  issues?: DiagnosticItem[];
  useRealCollectIssueItems?: boolean;
  runDiagnosticsError?: Error;
  tmuxInstalled?: boolean;
  insideTmux?: boolean;
  createSessionError?: Error;
  runReviewCycleResult?: CycleResult;
  runReviewCycleError?: Error;
  soundEnabled?: boolean;
  soundResult?: {
    played: boolean;
    reason?: string;
  };
  env?: Record<string, string | undefined>;
  cwd?: string;
  sessionStateData?: SessionState | null;
  generatedSessionId?: string;
  generatedSessionName?: string;
  gitBranch?: string | null;
  logSessionPath?: string;
  touchHeartbeatReject?: boolean;
  stdoutIsTTY?: boolean;
  openSessionPanelError?: Error;
}

interface RunHarness {
  overrides: RunRuntimeOverrides;
  errors: string[];
  warnings: string[];
  successes: string[];
  messages: string[];
  notes: Array<{ message: string; title: string }>;
  spinnerStarts: string[];
  spinnerStops: string[];
  exits: number[];
  diagnosticsCalls: Array<{
    context: string;
    options: Record<string, unknown>;
  }>;
  collectIssueItemsCalls: Array<{
    inputIds: string[];
    outputIds: string[];
  }>;
  createSessionCalls: Array<{ sessionName: string; command: string }>;
  createSessionStateCalls: Array<{ projectPath: string; sessionName: string; options: unknown }>;
  removeSessionStateCalls: Array<{ projectPath: string; expectedSessionId?: string }>;
  updateSessionStateCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }>;
  touchHeartbeatCalls: Array<{ projectPath: string; sessionId?: string }>;
  createLogSessionCalls: Array<{ projectPath: string; branch: string | undefined }>;
  runReviewCycleCalls: Array<{
    maxIterations: number;
    options: Record<string, unknown>;
    runtimeInfo: Record<string, unknown>;
  }>;
  resolveSoundEnabledCalls: Array<{ override: "on" | "off" | undefined }>;
  playSoundCalls: Array<"success" | "warning" | "error">;
  openSessionPanelCalls: Array<{ projectPath: string; branch: string | undefined }>;
  consoleLogs: string[];
  intervalHandlers: Array<() => void>;
  clearIntervalCalls: unknown[];
  parseCalls: Array<{ commandName: string; args: string[] }>;
  loadConfigCalls: Array<string | undefined>;
}

function createRunHarness(options: RunHarnessOptions = {}): RunHarness {
  const errors: string[] = [];
  const warnings: string[] = [];
  const successes: string[] = [];
  const messages: string[] = [];
  const notes: Array<{ message: string; title: string }> = [];
  const spinnerStarts: string[] = [];
  const spinnerStops: string[] = [];
  const exits: number[] = [];
  const diagnosticsCalls: Array<{ context: string; options: Record<string, unknown> }> = [];
  const collectIssueItemsCalls: Array<{
    inputIds: string[];
    outputIds: string[];
  }> = [];
  const createSessionCalls: Array<{ sessionName: string; command: string }> = [];
  const createSessionStateCalls: Array<{
    projectPath: string;
    sessionName: string;
    options: unknown;
  }> = [];
  const removeSessionStateCalls: Array<{ projectPath: string; expectedSessionId?: string }> = [];
  const updateSessionStateCalls: Array<{
    projectPath: string;
    updates: Record<string, unknown>;
    expectedSessionId?: string;
  }> = [];
  const touchHeartbeatCalls: Array<{ projectPath: string; sessionId?: string }> = [];
  const createLogSessionCalls: Array<{ projectPath: string; branch: string | undefined }> = [];
  const runReviewCycleCalls: Array<{
    maxIterations: number;
    options: Record<string, unknown>;
    runtimeInfo: Record<string, unknown>;
  }> = [];
  const resolveSoundEnabledCalls: Array<{ override: "on" | "off" | undefined }> = [];
  const playSoundCalls: Array<"success" | "warning" | "error"> = [];
  const openSessionPanelCalls: Array<{ projectPath: string; branch: string | undefined }> = [];
  const consoleLogs: string[] = [];
  const intervalHandlers: Array<() => void> = [];
  const clearIntervalCalls: unknown[] = [];
  const parseCalls: Array<{ commandName: string; args: string[] }> = [];
  const loadConfigCalls: Array<string | undefined> = [];

  const parseErrorFor = new Set(options.parseErrorFor ?? []);
  const runDef: CommandDef | undefined =
    options.commandDefs && "run" in options.commandDefs
      ? options.commandDefs.run
      : {
          name: "run",
          description: "Start review cycle",
        };
  const foregroundDef: CommandDef | undefined =
    options.commandDefs && "foreground" in options.commandDefs
      ? options.commandDefs.foreground
      : {
          name: "_run-foreground",
          description: "Internal",
        };

  const configQueue = [...(options.loadConfigResults ?? [createConfig()])];
  const diagnostics = options.diagnostics ?? createDiagnosticsReport([], createConfig());
  const processEnv = { ...(options.env ?? {}) };
  const cwd = options.cwd ?? "/repo/project";

  let nowTick = 10_000;

  const overrides: RunRuntimeOverrides = {
    prompt: {
      log: {
        error: (message) => {
          errors.push(message);
        },
        warn: (message) => {
          warnings.push(message);
        },
        success: (message) => {
          successes.push(message);
        },
        message: (message) => {
          messages.push(message);
        },
      },
      note: (message, title) => {
        notes.push({ message, title });
      },
      spinner: () => ({
        start: (message) => {
          spinnerStarts.push(message);
        },
        stop: (message) => {
          spinnerStops.push(message);
        },
      }),
    },
    getCommandDef: (name) => {
      if (name === "run") {
        return runDef;
      }
      if (name === "_run-foreground") {
        return foregroundDef;
      }
      return undefined;
    },
    parseCommand: ((def: CommandDef, args: string[]) => {
      parseCalls.push({ commandName: def.name, args: [...args] });
      if (parseErrorFor.has(def.name as "run" | "_run-foreground")) {
        throw new Error(`parse failure for ${def.name}`);
      }

      if (def.name === "run") {
        return {
          values: options.runValues ?? {},
          positional: [],
        };
      }

      return {
        values: options.foregroundValues ?? {},
        positional: [],
      };
    }) as unknown as typeof parseCommand,
    loadConfig: async (projectPath?: string) => {
      loadConfigCalls.push(projectPath);
      if (configQueue.length === 0) {
        return null;
      }
      return configQueue.shift() ?? null;
    },
    runDiagnostics: async (context, diagnosticsOptions) => {
      diagnosticsCalls.push({
        context,
        options: diagnosticsOptions as Record<string, unknown>,
      });
      if (options.runDiagnosticsError) {
        throw options.runDiagnosticsError;
      }
      return diagnostics;
    },
    collectIssueItems: (report) => {
      const collected = options.useRealCollectIssueItems
        ? collectIssueItemsFromDiagnostics(report)
        : (options.issues ?? report.items);
      collectIssueItemsCalls.push({
        inputIds: report.items.map((item) => item.id),
        outputIds: collected.map((item) => item.id),
      });
      return collected;
    },
    getTmuxInstallHint: () => "brew install tmux",
    runReviewCycle: async (config, _deps, runOptions, runtimeInfo) => {
      runReviewCycleCalls.push({
        maxIterations: config.maxIterations,
        options: runOptions as Record<string, unknown>,
        runtimeInfo: runtimeInfo as Record<string, unknown>,
      });
      if (options.runReviewCycleError) {
        throw options.runReviewCycleError;
      }
      return options.runReviewCycleResult ?? createCycleResult();
    },
    createLogSession: async (_storageRoot, projectPath, branch) => {
      createLogSessionCalls.push({
        projectPath,
        branch,
      });
      return options.logSessionPath ?? "/tmp/generated-session-path.jsonl";
    },
    sessionState: {
      createSessionState: async (_logsDir, projectPath, sessionName, sessionStateOptions) => {
        createSessionStateCalls.push({
          projectPath,
          sessionName,
          options: sessionStateOptions,
        });
      },
      createSessionId: () => options.generatedSessionId ?? "generated-session-id",
      readSessionState: async () => options.sessionStateData ?? null,
      removeSessionState: async (_logsDir, projectPath, _sessionId, sessionStateOptions) => {
        removeSessionStateCalls.push({
          projectPath,
          expectedSessionId: sessionStateOptions?.expectedSessionId,
        });
        return true;
      },
      touchSessionHeartbeat: async (_logsDir, projectPath, sessionId) => {
        touchHeartbeatCalls.push({ projectPath, sessionId });
        if (options.touchHeartbeatReject) {
          throw new Error("heartbeat failed");
        }
        return true;
      },
      updateSessionState: async (
        _logsDir,
        projectPath,
        _sessionId,
        updates,
        sessionStateOptions
      ) => {
        updateSessionStateCalls.push({
          projectPath,
          updates: updates as Record<string, unknown>,
          expectedSessionId: sessionStateOptions?.expectedSessionId,
        });
        return true;
      },
    },
    getGitBranch: async () => options.gitBranch ?? "main",
    sound: {
      resolveSoundEnabled: (_config, override) => {
        resolveSoundEnabledCalls.push({ override });
        return options.soundEnabled ?? false;
      },
      playCompletionSound: async (state) => {
        playSoundCalls.push(state);
        return options.soundResult ?? { played: true };
      },
    },
    tmux: {
      createSession: async (sessionName, command) => {
        createSessionCalls.push({ sessionName, command });
        if (options.createSessionError) {
          throw options.createSessionError;
        }
      },
      generateSessionName: () => options.generatedSessionName ?? "rr-project-main",
      isInsideTmux: () => options.insideTmux ?? false,
      isTmuxInstalled: () => options.tmuxInstalled ?? true,
    },
    process: {
      cwd: () => cwd,
      env: processEnv,
      pid: 4242,
      execPath: "/bun/bin/bun",
      stdoutIsTTY: options.stdoutIsTTY ?? true,
      exit: (code) => {
        exits.push(code);
        throw new Error(`${EXIT_PREFIX}${code}`);
      },
    },
    timer: {
      now: () => {
        nowTick += 1;
        return nowTick;
      },
      setInterval: (handler) => {
        intervalHandlers.push(handler);
        const handle = intervalHandlers.length;
        return handle as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: (handle) => {
        clearIntervalCalls.push(handle);
      },
    },
    openSessionPanel: async (projectPath, branch) => {
      openSessionPanelCalls.push({ projectPath, branch });
      if (options.openSessionPanelError) {
        throw options.openSessionPanelError;
      }
    },
    consoleLog: (...args) => {
      consoleLogs.push(args.map((arg) => String(arg)).join(" "));
    },
  };

  return {
    overrides,
    errors,
    warnings,
    successes,
    messages,
    notes,
    spinnerStarts,
    spinnerStops,
    exits,
    diagnosticsCalls,
    collectIssueItemsCalls,
    createSessionCalls,
    createSessionStateCalls,
    removeSessionStateCalls,
    updateSessionStateCalls,
    touchHeartbeatCalls,
    createLogSessionCalls,
    runReviewCycleCalls,
    resolveSoundEnabledCalls,
    playSoundCalls,
    openSessionPanelCalls,
    consoleLogs,
    intervalHandlers,
    clearIntervalCalls,
    parseCalls,
    loadConfigCalls,
  };
}

async function captureExitCode(run: () => Promise<void>): Promise<number | undefined> {
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

describe("run command", () => {
  describe("classifyRunCompletion", () => {
    test("returns success for clean run", () => {
      const state = classifyRunCompletion(
        createCycleResult({
          success: true,
          finalStatus: "completed",
          iterations: 2,
        })
      );
      expect(state).toBe("success");
    });

    test("returns warning for max-iteration completion with remaining issues", () => {
      const state = classifyRunCompletion(
        createCycleResult({
          success: false,
          finalStatus: "completed",
          iterations: 5,
          reason: "Max iterations (5) reached - some issues may remain",
        })
      );
      expect(state).toBe("warning");
    });

    test("returns warning for interrupted runs", () => {
      const state = classifyRunCompletion(
        createCycleResult({
          success: false,
          finalStatus: "interrupted",
          iterations: 3,
          reason: "Review cycle was interrupted",
        })
      );
      expect(state).toBe("warning");
    });

    test("returns error for failed terminal result", () => {
      const state = classifyRunCompletion(
        createCycleResult({
          success: false,
          finalStatus: "failed",
          iterations: 1,
          reason: "Reviewer failed with exit code 1",
        })
      );
      expect(state).toBe("error");
    });
  });

  describe("option parsing via cli-parser", () => {
    const runDef = getCommandDef("run");
    if (!runDef) throw new Error("run command def not found");

    test("parses --max=N option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--max=5"]);
      expect(values.max).toBe(5);
    });

    test("parses --max N option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--max", "5"]);
      expect(values.max).toBe(5);
    });

    test("parses -m N shorthand", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["-m", "3"]);
      expect(values.max).toBe(3);
    });

    test("parses --force option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--force"]);
      expect(values.force).toBe(true);
    });

    test("parses -f shorthand", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["-f"]);
      expect(values.force).toBe(true);
    });

    test("parses --commit option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--commit", "abc123"]);
      expect(values.commit).toBe("abc123");
    });

    test("parses --custom option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--custom", "Focus on security"]);
      expect(values.custom).toBe("Focus on security");
    });

    test("parses --simplifier option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--simplifier"]);
      expect(values.simplifier).toBe(true);
    });

    test("parses --sound option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--sound"]);
      expect(values.sound).toBe(true);
    });

    test("parses --no-sound option", () => {
      const { values } = parseCommand<RunOptions>(runDef, ["--no-sound"]);
      expect(values["no-sound"]).toBe(true);
    });
  });

  describe("sound helpers", () => {
    test("parseSoundOverride returns valid overrides", () => {
      expect(parseSoundOverride("on")).toBe("on");
      expect(parseSoundOverride("off")).toBe("off");
    });

    test("parseSoundOverride returns undefined for unknown values", () => {
      expect(parseSoundOverride("invalid")).toBeUndefined();
      expect(parseSoundOverride(undefined)).toBeUndefined();
    });

    test("resolveRunSoundOverride returns on for --sound", () => {
      expect(resolveRunSoundOverride({ sound: true })).toBe("on");
    });

    test("resolveRunSoundOverride returns off for --no-sound", () => {
      expect(resolveRunSoundOverride({ "no-sound": true })).toBe("off");
    });

    test("resolveRunSoundOverride returns undefined when no overrides are set", () => {
      expect(resolveRunSoundOverride({})).toBeUndefined();
    });

    test("resolveRunSoundOverride throws when both sound overrides are provided", () => {
      expect(() => resolveRunSoundOverride({ sound: true, "no-sound": true })).toThrow(
        "Cannot use --sound and --no-sound together"
      );
    });
  });

  describe("createRunRuntime", () => {
    test("applies nested prompt.log overrides", () => {
      const errors: string[] = [];
      const runtime = createRunRuntime({
        prompt: {
          log: {
            error: (message) => {
              errors.push(message);
            },
          },
        },
      });

      runtime.prompt.log.error("boom");
      expect(errors).toEqual(["boom"]);
    });

    test("exposes working default timer and console wrappers", () => {
      const runtime = createRunRuntime();
      const originalConsoleLog = console.log;
      console.log = (() => {}) as typeof console.log;
      const handle = runtime.timer.setInterval(() => {}, 1_000);
      try {
        runtime.timer.clearInterval(handle);
        runtime.consoleLog("runtime console wrapper");
        expect(typeof runtime.timer.now()).toBe("number");
      } finally {
        console.log = originalConsoleLog;
      }
    });

    test("exposes working default process.cwd wrapper", () => {
      const runtime = createRunRuntime();
      expect(runtime.process.cwd()).toBe(process.cwd());
    });

    test("delegates process exit through the runtime wrapper", () => {
      const runtime = createRunRuntime();
      const originalExit = process.exit;
      process.exit = ((code?: number) => {
        throw new Error(`${EXIT_PREFIX}${code ?? 0}`);
      }) as typeof process.exit;

      try {
        expect(() => runtime.process.exit(7)).toThrow(`${EXIT_PREFIX}7`);
      } finally {
        process.exit = originalExit;
      }
    });

    test("delegates openSessionPanel to dashboard renderer with explicit branch", async () => {
      const renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }> = [];
      mock.module("@/lib/tui/index", () => ({
        renderDashboard: async (payload: { projectPath: string; branch: string | undefined }) => {
          renderDashboardCalls.push(payload);
        },
      }));

      try {
        const runtime = createRunRuntime();
        await runtime.openSessionPanel("/repo/project", "feature/test");

        expect(renderDashboardCalls).toEqual([
          {
            projectPath: "/repo/project",
            branch: "feature/test",
          },
        ]);
      } finally {
        mock.restore();
      }
    });

    test("delegates openSessionPanel to dashboard renderer with undefined branch", async () => {
      const renderDashboardCalls: Array<{ projectPath: string; branch: string | undefined }> = [];
      mock.module("@/lib/tui/index", () => ({
        renderDashboard: async (payload: { projectPath: string; branch: string | undefined }) => {
          renderDashboardCalls.push(payload);
        },
      }));

      try {
        const runtime = createRunRuntime();
        await runtime.openSessionPanel("/repo/project");

        expect(renderDashboardCalls).toEqual([
          {
            projectPath: "/repo/project",
            branch: undefined,
          },
        ]);
      } finally {
        mock.restore();
      }
    });
  });

  describe("resolveRunSimplifierEnabled", () => {
    test("returns true when --simplifier is passed even if config is false", () => {
      const config = {
        ...createConfig(),
        run: { simplifier: false },
      } satisfies Config;
      expect(resolveRunSimplifierEnabled({ simplifier: true }, config)).toBe(true);
    });

    test("uses config default when --simplifier is not passed", () => {
      const config = {
        ...createConfig(),
        run: { simplifier: true },
      } satisfies Config;
      expect(resolveRunSimplifierEnabled({}, config)).toBe(true);
    });

    test("defaults to false when config run settings are missing", () => {
      const config = {
        ...createConfig(),
      };
      delete config.run;

      expect(resolveRunSimplifierEnabled({}, config)).toBe(false);
      expect(resolveRunSimplifierEnabled({}, null)).toBe(false);
    });
  });

  describe("getDynamicProbeAgents", () => {
    test("returns empty when config is null", () => {
      expect(getDynamicProbeAgents(null)).toEqual([]);
    });

    test("returns unique dynamic agents discovered across roles", () => {
      const config = createConfig();
      config.reviewer = {
        agent: "opencode",
        model: "gpt-5.3-codex",
      };
      config.fixer = {
        agent: "opencode",
        model: "gpt-5.3-codex",
      };
      config["code-simplifier"] = {
        agent: "pi",
        provider: "anthropic",
        model: "claude-opus-4-6",
      };

      expect(new Set(getDynamicProbeAgents(config))).toEqual(new Set(["opencode", "pi"]));
    });

    test("returns empty when only static agents are configured", () => {
      expect(getDynamicProbeAgents(createConfig())).toEqual([]);
    });
  });

  describe("formatRunAgentsNote", () => {
    test("includes Simplifier line when simplifier is enabled with configured code-simplifier", () => {
      const config = createConfig();

      const note = formatRunAgentsNote(config, {
        simplifier: true,
      });

      expect(note).toContain("Reviewer:");
      expect(note).toContain("Fixer:");
      expect(note).toContain("Simplifier: Droid");
      expect(note).toContain("Review:");
    });

    test("falls back to reviewer details when code-simplifier is not configured", () => {
      const config = createConfig();
      delete config["code-simplifier"];

      const note = formatRunAgentsNote(config, {
        simplifier: true,
      });

      expect(note).toContain("Simplifier: Codex");
    });

    test("omits Simplifier line when simplifier is disabled", () => {
      const config = createConfig();

      const note = formatRunAgentsNote(config, {
        simplifier: false,
      });

      expect(note).not.toContain("Simplifier:");
    });
  });

  describe("startReview", () => {
    test("exits with an internal error when run command definition is missing", async () => {
      const harness = createRunHarness({
        commandDefs: {
          run: undefined,
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("Internal error: run command definition not found");
    });

    test("exits when parsing run options fails", async () => {
      const harness = createRunHarness({
        parseErrorFor: ["run"],
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("parse failure for run");
    });

    test("exits when max iterations is non-positive", async () => {
      const harness = createRunHarness({
        runValues: { max: 0 },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("--max must be a positive number");
    });

    test("exits when sound flags conflict", async () => {
      const harness = createRunHarness({
        runValues: {
          sound: true,
          "no-sound": true,
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("Cannot use --sound and --no-sound together");
    });

    test("starts the background review without launching Interactive Mode", async () => {
      const harness = createRunHarness();

      await startReview([], harness.overrides);

      expect(harness.openSessionPanelCalls).toHaveLength(0);
      expect(harness.messages).not.toContain("Interactive Mode closed.");
      expect(harness.messages).not.toContain("Launch Interactive Mode: rr");
    });

    test("fills base branch from defaultReview when no explicit mode is provided", async () => {
      const config = createConfig();
      config.defaultReview = {
        type: "base",
        branch: "origin/main",
      };
      const harness = createRunHarness({
        runValues: {},
        loadConfigResults: [config],
      });

      await startReview([], harness.overrides);

      expect(harness.diagnosticsCalls).toHaveLength(1);
      expect(harness.diagnosticsCalls[0]?.options.baseBranch).toBe("origin/main");
      expect(harness.createSessionCalls).toHaveLength(1);
    });

    test("loads the effective config using RR_PROJECT_PATH during startup", async () => {
      const harness = createRunHarness({
        env: {
          RR_PROJECT_PATH: "/repo/nested/project",
        },
      });

      await startReview([], harness.overrides);

      expect(harness.loadConfigCalls[0]).toBe("/repo/nested/project");
      expect(harness.diagnosticsCalls[0]?.options.projectPath).toBe("/repo/nested/project");
    });

    test("uses RR_PROJECT_PATH for background session state and env", async () => {
      const harness = createRunHarness({
        env: {
          RR_PROJECT_PATH: "/repo/nested/project",
        },
        cwd: "/repo/current-shell-dir",
        generatedSessionId: "session-xyz",
        generatedSessionName: "rr-main-xyz",
      });

      await startReview([], harness.overrides);

      expect(harness.createSessionStateCalls[0]?.projectPath).toBe("/repo/nested/project");
      expect(harness.createSessionCalls[0]?.command).toContain(
        "RR_PROJECT_PATH='/repo/nested/project'"
      );
      expect(harness.createSessionCalls[0]?.command).not.toContain(
        "RR_PROJECT_PATH='/repo/current-shell-dir'"
      );
    });

    test("trims base branch from defaultReview before diagnostics", async () => {
      const config = createConfig();
      config.defaultReview = {
        type: "base",
        branch: " origin/main ",
      };
      const harness = createRunHarness({
        runValues: {},
        loadConfigResults: [config],
      });

      await startReview([], harness.overrides);

      expect(harness.diagnosticsCalls).toHaveLength(1);
      expect(harness.diagnosticsCalls[0]?.options.baseBranch).toBe("origin/main");
    });

    test("passes custom instructions to diagnostics when custom mode is selected", async () => {
      const harness = createRunHarness({
        runValues: {
          custom: "focus on security",
        },
      });

      await startReview([], harness.overrides);

      expect(harness.diagnosticsCalls).toHaveLength(1);
      expect(harness.diagnosticsCalls[0]?.options.customInstructions).toBe("focus on security");
    });

    test("allows base and custom options together", async () => {
      const harness = createRunHarness({
        runValues: {
          base: "main",
          custom: "focus on security",
        },
      });

      await startReview([], harness.overrides);

      expect(harness.diagnosticsCalls).toHaveLength(1);
      expect(harness.diagnosticsCalls[0]?.options.baseBranch).toBe("main");
      expect(harness.diagnosticsCalls[0]?.options.customInstructions).toBe("focus on security");
      expect(harness.createSessionCalls).toHaveLength(1);
    });

    test("allows commit and custom options together", async () => {
      const harness = createRunHarness({
        runValues: {
          commit: "abc123",
          custom: "focus on security",
        },
      });

      await startReview([], harness.overrides);

      expect(harness.diagnosticsCalls).toHaveLength(1);
      expect(harness.diagnosticsCalls[0]?.options.commitSha).toBe("abc123");
      expect(harness.diagnosticsCalls[0]?.options.customInstructions).toBe("focus on security");
      expect(harness.createSessionCalls).toHaveLength(1);
    });

    test("exits when base branch is an empty string", async () => {
      const harness = createRunHarness({
        runValues: {
          base: "",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("--base cannot be empty");
      expect(harness.diagnosticsCalls).toHaveLength(0);
    });

    test("does not fallback to defaultReview when base is explicitly empty", async () => {
      const config = createConfig();
      config.defaultReview = {
        type: "base",
        branch: "origin/main",
      };
      const harness = createRunHarness({
        runValues: {
          base: "",
        },
        loadConfigResults: [config],
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("--base cannot be empty");
      expect(harness.diagnosticsCalls).toHaveLength(0);
    });

    test("exits when commit sha is an empty string", async () => {
      const harness = createRunHarness({
        runValues: {
          commit: "",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("--commit cannot be empty");
      expect(harness.diagnosticsCalls).toHaveLength(0);
    });

    test("exits when custom instructions are an empty string", async () => {
      const harness = createRunHarness({
        runValues: {
          custom: "",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("--custom cannot be empty");
      expect(harness.diagnosticsCalls).toHaveLength(0);
    });

    test("exits when mutually exclusive review mode options are combined", async () => {
      const harness = createRunHarness({
        runValues: {
          base: "main",
          commit: "abc123",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("Cannot use --base and --commit together");
    });

    test("exits when --uncommitted and --custom are combined", async () => {
      const harness = createRunHarness({
        runValues: {
          uncommitted: true,
          custom: "focus on security",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("Cannot use --uncommitted and --custom together");
    });

    test("exits when --uncommitted and --base are combined", async () => {
      const harness = createRunHarness({
        runValues: {
          uncommitted: true,
          base: "main",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("Cannot use --uncommitted and --base together");
    });

    test("exits when --uncommitted and --commit are combined", async () => {
      const harness = createRunHarness({
        runValues: {
          uncommitted: true,
          commit: "abc123",
        },
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors[0]).toContain("Cannot use --uncommitted and --commit together");
    });

    test("prints diagnostic errors and remediation and exits", async () => {
      const errorItem: DiagnosticItem = {
        id: "git-worktree-state",
        category: "environment",
        title: "Worktree setup failed",
        severity: "error",
        summary: "The review worktree could not be prepared.",
        remediation: ["Retry rr run", "Inspect git status"],
      };
      const harness = createRunHarness({
        diagnostics: createDiagnosticsReport([errorItem], createConfig()),
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("Cannot run review:");
      expect(harness.messages).toContain("  The review worktree could not be prepared.");
      expect(harness.messages).toContain("    -> Retry rr run");
      expect(harness.messages).toContain("    -> Inspect git status");
    });

    test("prints warnings but continues when diagnostics are non-blocking", async () => {
      const warningItem: DiagnosticItem = {
        id: "agent-opencode-probe",
        category: "agents",
        title: "opencode capability probe",
        severity: "warning",
        summary: "Model discovery probe returned warnings.",
        remediation: ["Run opencode --help"],
      };
      const harness = createRunHarness({
        diagnostics: createDiagnosticsReport([warningItem], createConfig()),
      });

      await startReview([], harness.overrides);

      expect(harness.warnings).toContain("Preflight warnings:");
      expect(harness.messages).toContain("  Model discovery probe returned warnings.");
      expect(harness.messages).toContain("    -> Run opencode --help");
      expect(harness.createSessionCalls).toHaveLength(1);
    });

    test("uses real issue collection to filter ok diagnostics before warning output", async () => {
      const okItem: DiagnosticItem = {
        id: "git-uncommitted",
        category: "git",
        title: "Uncommitted changes",
        severity: "ok",
        summary: "Uncommitted changes detected.",
        remediation: [],
      };
      const warningItem: DiagnosticItem = {
        id: "agent-opencode-probe",
        category: "agents",
        title: "opencode capability probe",
        severity: "warning",
        summary: "Model discovery probe returned warnings.",
        remediation: ["Run opencode --help"],
      };
      const harness = createRunHarness({
        useRealCollectIssueItems: true,
        diagnostics: createDiagnosticsReport([okItem, warningItem], createConfig()),
      });

      await startReview([], harness.overrides);

      expect(harness.collectIssueItemsCalls).toEqual([
        {
          inputIds: ["git-uncommitted", "agent-opencode-probe"],
          outputIds: ["agent-opencode-probe"],
        },
      ]);
      expect(harness.warnings).toContain("Preflight warnings:");
      expect(harness.messages).not.toContain("  Uncommitted changes detected.");
      expect(harness.createSessionCalls).toHaveLength(1);
    });

    test("stops spinner even when diagnostics throws", async () => {
      const harness = createRunHarness({
        runDiagnosticsError: new Error("diagnostics exploded"),
      });

      await expect(startReview([], harness.overrides)).rejects.toThrow("diagnostics exploded");
      expect(harness.spinnerStarts).toEqual(["Running preflight checks..."]);
      expect(harness.spinnerStops).toEqual(["Preflight checks complete."]);
    });

    test("exits when diagnostics does not provide config and reload also fails", async () => {
      const firstConfig = createConfig();
      const harness = createRunHarness({
        loadConfigResults: [firstConfig, null],
        diagnostics: createDiagnosticsReport([], null),
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("Failed to load configuration");
    });

    test("warns when running inside tmux", async () => {
      const harness = createRunHarness({
        insideTmux: true,
      });

      await startReview([], harness.overrides);

      expect(harness.warnings).toContain(
        "Running inside tmux session. Review will start in a nested session."
      );
    });

    test("exits with install hint when tmux is missing", async () => {
      const harness = createRunHarness({
        tmuxInstalled: false,
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("tmux is not installed. Install with: brew install tmux");
    });

    test("removes session state and exits when background session creation fails", async () => {
      const harness = createRunHarness({
        generatedSessionId: "session-abc",
        createSessionError: new Error("tmux create-session failed"),
      });

      const exitCode = await captureExitCode(async () => {
        await startReview([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.createSessionStateCalls).toHaveLength(1);
      expect(harness.removeSessionStateCalls).toEqual([
        {
          projectPath: "/repo/project",
          expectedSessionId: "session-abc",
        },
      ]);
      expect(harness.errors[0]).toContain("Failed to start background session");
    });

    test("builds background command with escaped env vars and flags", async () => {
      const config = createConfig();
      const harness = createRunHarness({
        runValues: {
          max: 3,
          force: true,
          custom: "check O'Hara path",
          simplifier: true,
          sound: true,
        },
        loadConfigResults: [config],
        generatedSessionId: "session-xyz",
        generatedSessionName: "rr-main-xyz",
        gitBranch: "feature/run",
      });

      await startReview([], harness.overrides);

      expect(harness.createSessionCalls).toHaveLength(1);
      const command = harness.createSessionCalls[0]?.command ?? "";
      expect(command).toContain("RR_PROJECT_PATH='/repo/project'");
      expect(command).toContain("RR_GIT_BRANCH='feature/run'");
      expect(command).toContain("RR_SESSION_ID='session-xyz'");
      expect(command).toContain("RR_SESSION_PATH='/tmp/generated-session-path.jsonl'");
      expect(command).toContain("RR_SOUND_OVERRIDE='on'");
      expect(command).toContain("RR_CUSTOM_PROMPT='check O'\\''Hara path'");
      expect(command).toContain("_run-foreground --max 3 --force --simplifier");
      expect(harness.successes).toContain("Review started in background session: rr-main-xyz");
      expect(harness.notes.map((entry) => entry.title)).toEqual(["Agents", "Commands"]);
    });

    test("records sessionPath before exposing a background session", async () => {
      const harness = createRunHarness({
        gitBranch: "feature/run",
        generatedSessionId: "session-xyz",
        logSessionPath: "/tmp/background-session.jsonl",
      });

      await startReview([], harness.overrides);

      expect(harness.createLogSessionCalls).toEqual([
        {
          projectPath: "/repo/project",
          branch: "feature/run",
        },
      ]);
      expect(
        (harness.createSessionStateCalls[0]?.options as { sessionPath?: string } | undefined)
          ?.sessionPath
      ).toBe("/tmp/background-session.jsonl");
    });

    test("includes commit sha in background environment when commit mode is selected", async () => {
      const harness = createRunHarness({
        runValues: {
          commit: "abc123",
        },
      });

      await startReview([], harness.overrides);

      const command = harness.createSessionCalls[0]?.command ?? "";
      expect(command).toContain("RR_COMMIT_SHA='abc123'");
    });
  });

  describe("runForeground", () => {
    test("exits when config fails to load", async () => {
      const harness = createRunHarness({
        loadConfigResults: [null],
      });

      const exitCode = await captureExitCode(async () => {
        await runForeground([], harness.overrides);
      });

      expect(exitCode).toBe(1);
      expect(harness.errors).toContain("Failed to load config");
    });

    test("loads the effective config using RR_PROJECT_PATH before running the cycle", async () => {
      const harness = createRunHarness({
        env: {
          RR_PROJECT_PATH: "/repo/nested/project",
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.loadConfigCalls[0]).toBe("/repo/nested/project");
      expect(harness.updateSessionStateCalls[0]?.projectPath).toBe("/repo/nested/project");
    });

    test("uses RR_SESSION_ID from env for lock updates and runtime info", async () => {
      const harness = createRunHarness({
        env: {
          RR_SESSION_ID: "env-session-id",
        },
        sessionStateData: createLockData("env-session-id"),
      });

      await runForeground([], harness.overrides);

      expect(harness.updateSessionStateCalls[0]?.expectedSessionId).toBe("env-session-id");
      expect(harness.runReviewCycleCalls[0]?.runtimeInfo.sessionId).toBe("env-session-id");
    });

    test("creates a new foreground session state when RR_SESSION_ID is absent", async () => {
      const harness = createRunHarness({
        sessionStateData: createLockData("existing-session-id"),
        generatedSessionId: "generated-session-id",
      });

      await runForeground([], harness.overrides);

      expect(harness.createSessionStateCalls).toHaveLength(1);
      expect(harness.createSessionStateCalls[0]?.projectPath).toBe("/repo/project");
      expect(harness.createSessionStateCalls[0]?.sessionName).toBe("rr-project-main");
      expect(
        (harness.createSessionStateCalls[0]?.options as { sessionId?: string } | undefined)
          ?.sessionId
      ).toBe("generated-session-id");
      expect(
        (harness.createSessionStateCalls[0]?.options as { sessionPath?: string } | undefined)
          ?.sessionPath
      ).toBe("/tmp/generated-session-path.jsonl");
      expect(harness.updateSessionStateCalls[0]?.expectedSessionId).toBe("generated-session-id");
      expect(harness.runReviewCycleCalls[0]?.runtimeInfo.sessionId).toBe("generated-session-id");
      expect(harness.runReviewCycleCalls[0]?.runtimeInfo.sessionPath).toBe(
        "/tmp/generated-session-path.jsonl"
      );
      expect(harness.createLogSessionCalls).toEqual([
        {
          projectPath: "/repo/project",
          branch: "main",
        },
      ]);
    });

    test("reuses the persisted sessionPath for existing foreground session state", async () => {
      const harness = createRunHarness({
        env: {
          RR_SESSION_ID: "env-session-id",
        },
        sessionStateData: {
          ...createLockData("env-session-id"),
          sessionPath: "/tmp/persisted-session-path.jsonl",
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.runReviewCycleCalls[0]?.runtimeInfo.sessionId).toBe("env-session-id");
      expect(harness.runReviewCycleCalls[0]?.runtimeInfo.sessionPath).toBe(
        "/tmp/persisted-session-path.jsonl"
      );
      expect(harness.createLogSessionCalls).toEqual([]);
    });

    test("parses internal foreground args and sets simplifier/force/max", async () => {
      const harness = createRunHarness({
        foregroundValues: {
          max: 9,
          force: true,
          simplifier: true,
        },
      });

      await runForeground(["--max", "9", "--force", "--simplifier"], harness.overrides);

      expect(harness.runReviewCycleCalls[0]?.maxIterations).toBe(9);
      expect(harness.runReviewCycleCalls[0]?.options.forceMaxIterations).toBe(true);
      expect(harness.runReviewCycleCalls[0]?.options.simplifier).toBe(true);
      expect(harness.updateSessionStateCalls[0]?.updates.currentAgent).toBeNull();
    });

    test("ignores internal parser failures and continues with defaults", async () => {
      const harness = createRunHarness({
        parseErrorFor: ["_run-foreground"],
      });

      await runForeground(["--max", "bad"], harness.overrides);

      expect(harness.runReviewCycleCalls[0]?.maxIterations).toBe(5);
      expect(harness.runReviewCycleCalls[0]?.options.forceMaxIterations).toBe(false);
      expect(harness.runReviewCycleCalls[0]?.options.simplifier).toBe(false);
      expect(harness.updateSessionStateCalls[0]?.updates.currentAgent).toBeNull();
    });

    test("runs even when _run-foreground command definition is missing", async () => {
      const harness = createRunHarness({
        commandDefs: {
          foreground: undefined,
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.parseCalls.some((entry) => entry.commandName === "_run-foreground")).toBe(
        false
      );
      expect(harness.runReviewCycleCalls).toHaveLength(1);
    });

    test("logs warning completion for interrupted result", async () => {
      const harness = createRunHarness({
        runReviewCycleResult: createCycleResult({
          success: false,
          finalStatus: "interrupted",
          iterations: 4,
          reason: "Interrupted by signal",
        }),
      });

      await runForeground([], harness.overrides);

      expect(harness.warnings).toContain(
        "Review cycle complete with warnings: Interrupted by signal (4 iterations)"
      );
      expect(harness.updateSessionStateCalls[1]?.updates.state).toBe("interrupted");
    });

    test("surfaces the retained worktree path and branch after a successful run", async () => {
      const harness = createRunHarness({
        runReviewCycleResult: createCycleResult({
          reviewOutcome: "incomplete",
          retainedWorktree: {
            worktreeProjectPath:
              "/Users/test/.config/ralph-review/test-project-12345678/worktrees/session-123",
            worktreeBranch: "rr-worktree-session-123",
            mergeReady: true,
            commitSha: "retained-commit-sha",
          },
        }),
      });

      await runForeground([], harness.overrides);

      expect(harness.notes).toContainEqual({
        title: "Worktree",
        message:
          "Retained worktree for review:\n" +
          "Path: /Users/test/.config/ralph-review/test-project-12345678/worktrees/session-123\n" +
          "Branch: rr-worktree-session-123",
      });
      expect(harness.updateSessionStateCalls[1]?.updates.worktreeProjectPath).toBe(
        "/Users/test/.config/ralph-review/test-project-12345678/worktrees/session-123"
      );
      expect(harness.updateSessionStateCalls[1]?.updates.worktreeBranch).toBe(
        "rr-worktree-session-123"
      );
      expect(harness.updateSessionStateCalls[1]?.updates.reviewOutcome).toBe("incomplete");
      expect(harness.updateSessionStateCalls[1]?.updates.worktreeMergeReady).toBe(true);
      expect(harness.updateSessionStateCalls[1]?.updates.worktreeCommitSha).toBe(
        "retained-commit-sha"
      );
    });

    test("surfaces automatic handoff apply after a successful run", async () => {
      const harness = createRunHarness({
        env: {
          RR_SESSION_ID: "session-123",
        },
        runReviewCycleResult: createCycleResult({
          reviewOutcome: "incomplete",
          handoffStatus: "applied-auto",
          commitSha: "retained-commit-sha",
          handoffUpdatedAt: 1_700_000_000_000,
        }),
      });

      await runForeground([], harness.overrides);

      expect(harness.notes).toContainEqual({
        title: "Handoff",
        message: "Applied reviewed fixes to the working tree.\nCommit: retained-commit-sha",
      });
      expect(harness.updateSessionStateCalls[1]?.updates.handoffStatus).toBe("applied-auto");
      expect(harness.updateSessionStateCalls[1]?.updates.commitSha).toBe("retained-commit-sha");
    });

    test("surfaces manual handoff commands when fixes are pending", async () => {
      const harness = createRunHarness({
        env: {
          RR_SESSION_ID: "session-123",
        },
        runReviewCycleResult: createCycleResult({
          reviewOutcome: "incomplete",
          handoffStatus: "pending-apply",
          commitSha: "retained-commit-sha",
          handoffUpdatedAt: 1_700_000_000_000,
        }),
      });

      await runForeground([], harness.overrides);

      expect(harness.notes).toContainEqual({
        title: "Handoff",
        message:
          "Reviewed fixes are ready to apply.\n" +
          "Commit: retained-commit-sha\n" +
          "Apply: rr apply --session session-123\n" +
          "Discard: rr discard --session session-123",
      });
      expect(harness.updateSessionStateCalls[1]?.updates.handoffStatus).toBe("pending-apply");
      expect(harness.updateSessionStateCalls[1]?.updates.commitSha).toBe("retained-commit-sha");
    });

    test("logs error completion for failed result", async () => {
      const harness = createRunHarness({
        runReviewCycleResult: createCycleResult({
          success: false,
          finalStatus: "failed",
          iterations: 1,
          reason: "Reviewer failed",
        }),
      });

      await runForeground([], harness.overrides);

      expect(harness.errors).toContain("Review stopped: Reviewer failed (1 iterations)");
      expect(harness.updateSessionStateCalls[1]?.updates.state).toBe("failed");
    });

    test("writes failed terminal state and cleans up when runReviewCycle throws", async () => {
      const harness = createRunHarness({
        runReviewCycleError: new Error("cycle crashed"),
      });

      await expect(runForeground([], harness.overrides)).rejects.toThrow("cycle crashed");
      expect(harness.clearIntervalCalls).toHaveLength(1);
      expect(harness.updateSessionStateCalls).toHaveLength(2);
      expect(harness.updateSessionStateCalls[1]?.updates.state).toBe("failed");
      expect(harness.updateSessionStateCalls[1]?.updates.reason).toBe("Review exited unexpectedly");
      expect(harness.removeSessionStateCalls).toHaveLength(1);
    });

    test("plays completion sound when enabled and warns if playback fails", async () => {
      const harness = createRunHarness({
        soundEnabled: true,
        soundResult: {
          played: false,
          reason: "No backend",
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.playSoundCalls).toEqual(["success"]);
      expect(harness.warnings).toContain("Could not play completion sound: No backend");
    });

    test("does not play sound when disabled", async () => {
      const harness = createRunHarness({
        soundEnabled: false,
      });

      await runForeground([], harness.overrides);

      expect(harness.playSoundCalls).toHaveLength(0);
    });

    test("passes parsed RR_SOUND_OVERRIDE into resolveSoundEnabled", async () => {
      const harness = createRunHarness({
        env: {
          RR_SOUND_OVERRIDE: "on",
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.resolveSoundEnabledCalls).toEqual([{ override: "on" }]);
    });

    test("passes undefined override for invalid RR_SOUND_OVERRIDE values", async () => {
      const harness = createRunHarness({
        env: {
          RR_SOUND_OVERRIDE: "sometimes",
        },
      });

      await runForeground([], harness.overrides);

      expect(harness.resolveSoundEnabledCalls).toEqual([{ override: undefined }]);
    });

    test("swallows heartbeat touch failures from interval handler", async () => {
      const harness = createRunHarness({
        touchHeartbeatReject: true,
      });

      await runForeground([], harness.overrides);
      const heartbeat = harness.intervalHandlers[0];
      if (!heartbeat) {
        throw new Error("heartbeat handler was not registered");
      }

      heartbeat();
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.touchHeartbeatCalls).toHaveLength(1);
    });
  });
});
