import { describe, expect, test } from "bun:test";
import {
  resolveArchivedHandoffSelection,
  resolvePendingHandoffSelection,
} from "@/commands/handoff-selection";
import type { ArchivedAppliedHandoffArtifact, PendingHandoffArtifact } from "@/lib/handoff";

function createPendingHandoff(
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  const projectPath = process.cwd();
  return {
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: `${projectPath}/.ralph-review/handoffs/session-id.patch`,
    trackedRepoFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createArchivedHandoff(
  overrides: Partial<ArchivedAppliedHandoffArtifact> = {}
): ArchivedAppliedHandoffArtifact {
  const projectPath = process.cwd();
  return {
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    patchPath: `${projectPath}/.ralph-review/handoff-history/session-id.patch`,
    trackedRepoFingerprint: "fingerprint-source-1",
    appliedFingerprint: "fingerprint-applied-1",
    commitSha: "commit-sha-1",
    appliedVia: "auto",
    state: "archived-applied",
    createdAt: 1,
    appliedAt: 2,
    ...overrides,
  };
}

describe("resolvePendingHandoffSelection", () => {
  test("returns the only pending handoff without prompting", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [createPendingHandoff()],
      action: "apply",
      isTTY: true,
    });

    expect(result.handoff?.sessionId).toBe("session-id");
    expect(result.error).toBeUndefined();
  });

  test("returns an error when the session selector is blank", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [createPendingHandoff()],
      selector: "   ",
      action: "apply",
      isTTY: true,
    });

    expect(result).toEqual({
      handoff: null,
      error: "Session selector cannot be empty.",
    });
  });

  test("accepts a unique session id prefix", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      selector: "session-a",
      action: "discard",
      isTTY: true,
    });

    expect(result.handoff?.sessionId).toBe("session-alpha");
    expect(result.error).toBeUndefined();
  });

  test("returns an error when the selector is ambiguous", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-atom" }),
      ],
      selector: "session-a",
      action: "apply",
      isTTY: true,
    });

    expect(result).toEqual({
      handoff: null,
      error: 'Session selector "session-a" is ambiguous for the current project.',
    });
  });

  test("prompts when multiple handoffs exist in an interactive terminal", async () => {
    const prompts: string[] = [];
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      action: "discard",
      isTTY: true,
      select: async (input) => {
        prompts.push(input.message);
        return "session-beta";
      },
    });

    expect(prompts).toEqual(["Choose a review handoff to discard"]);
    expect(result.handoff?.sessionId).toBe("session-beta");
  });

  test("returns an error when multiple handoffs exist in a non-interactive terminal", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      action: "apply",
      isTTY: false,
    });

    expect(result).toEqual({
      handoff: null,
      error:
        "Multiple pending review handoffs exist for this project. Re-run with --session <id|name>.",
    });
  });

  test("returns null when the interactive selection is cancelled", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ sessionId: "session-alpha" }),
        createPendingHandoff({ sessionId: "session-beta" }),
      ],
      action: "apply",
      isTTY: true,
      select: async () => "__CANCEL__",
      isCancel: (value) => value === "__CANCEL__",
    });

    expect(result).toEqual({
      handoff: null,
    });
  });
});

describe("resolveArchivedHandoffSelection", () => {
  test("returns an error when the archived session selector does not match", async () => {
    const result = await resolveArchivedHandoffSelection({
      handoffs: [createArchivedHandoff({ sessionId: "session-alpha" })],
      selector: "session-z",
      action: "reapply",
      isTTY: true,
    });

    expect(result).toEqual({
      handoff: null,
      error: 'No archived review handoff matches "session-z" in the current project.',
    });
  });

  test("prompts when multiple archived handoffs match in an interactive terminal", async () => {
    const prompts: string[] = [];
    const result = await resolveArchivedHandoffSelection({
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      action: "revert",
      isTTY: true,
      select: async (input) => {
        prompts.push(input.message);
        return "session-beta";
      },
    });

    expect(prompts).toEqual(["Choose a review handoff to revert"]);
    expect(result.handoff?.sessionId).toBe("session-beta");
  });

  test("returns an error when multiple archived handoffs match in a non-interactive terminal", async () => {
    const result = await resolveArchivedHandoffSelection({
      handoffs: [
        createArchivedHandoff({ sessionId: "session-alpha" }),
        createArchivedHandoff({ sessionId: "session-beta" }),
      ],
      action: "reapply",
      isTTY: false,
    });

    expect(result).toEqual({
      handoff: null,
      error:
        "Multiple archived review handoffs match the current repository state. Re-run with --session <id|name>.",
    });
  });
});
