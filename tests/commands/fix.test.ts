import { describe, expect, test } from "bun:test";
import { parseFixCommandOptions, runFix } from "@/commands/fix";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";
import { createConfig } from "../helpers/diagnostics";

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

  test("passes selector unions through to remediation execution", async () => {
    const calls: Array<{
      sessionId: string;
      selector?: {
        all?: boolean;
        priorities?: string[];
        ids?: string[];
      };
      isTTY: boolean;
    }> = [];
    const errors: string[] = [];
    const exits: number[] = [];

    await runFix(["--session", "session-123", "--priority", "P0", "--priority", "P1"], {
      loadConfig: async () => createConfig(),
      loadFindingsArtifactBySessionId: async () => createArtifact(),
      runFixSession: async (_config, options) => {
        calls.push({
          sessionId: options.sessionId,
          selector: options.selector,
          isTTY: options.isTTY,
        });
        return {
          phase: "selection",
          sessionStatus: "pending-user",
          reviewOutcome: "findings-pending",
          reason: "No findings were selected. Findings remain pending.",
          artifact: createArtifact(),
          selection: {
            selectedFindingIds: [],
            selectedFindings: [],
          },
          fixResults: [],
          unresolvedSelectedFindings: [],
          unselectedFindings: createArtifact().findings,
        };
      },
      isTTY: () => false,
      logError: (message) => {
        errors.push(message);
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    expect(calls).toEqual([
      {
        sessionId: "session-123",
        selector: {
          priorities: ["P0", "P1"],
        },
        isTTY: false,
      },
    ]);
    expect(errors).toEqual([]);
    expect(exits).toEqual([]);
  });

  test("passes non-interactive omission through so remediation can reject it with guidance", async () => {
    const calls: Array<{ sessionId: string; selector: unknown; isTTY: boolean }> = [];
    const errors: string[] = [];
    const exits: number[] = [];

    await runFix(["--session", "session-123"], {
      loadConfig: async () => createConfig(),
      loadFindingsArtifactBySessionId: async () => createArtifact(),
      runFixSession: async (_config, options) => {
        calls.push({
          sessionId: options.sessionId,
          selector: options.selector,
          isTTY: options.isTTY,
        });
        return {
          phase: "selection",
          sessionStatus: "failed",
          reviewOutcome: "incomplete",
          reason:
            "No selector was provided. Re-run with one of --all, --priority, or --id, or use an interactive terminal.",
          artifact: createArtifact(),
          selection: {
            selectedFindingIds: [],
            selectedFindings: [],
          },
          fixResults: [],
          unresolvedSelectedFindings: [],
          unselectedFindings: createArtifact().findings,
        };
      },
      isTTY: () => false,
      logError: (message) => {
        errors.push(message);
      },
      exit: (code) => {
        exits.push(code);
      },
    });

    expect(calls).toEqual([
      {
        sessionId: "session-123",
        selector: undefined,
        isTTY: false,
      },
    ]);
    expect(errors).toEqual([
      "No selector was provided. Re-run with one of --all, --priority, or --id, or use an interactive terminal.",
    ]);
    expect(exits).toEqual([1]);
  });
});
