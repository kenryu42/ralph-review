import { describe, expect, test } from "bun:test";
import { resolvePendingHandoffSelection } from "@/commands/handoff-selection";
import type { PendingHandoffArtifact } from "@/lib/handoff";

function createPendingHandoff(
  overrides: Partial<PendingHandoffArtifact> = {}
): PendingHandoffArtifact {
  const projectPath = process.cwd();
  return {
    handoffId: overrides.handoffId ?? overrides.sessionId ?? "session-id",
    sessionId: "session-id",
    projectPath,
    sourceRepoPath: projectPath,
    logPath: `${projectPath}/.ralph-review/logs/session.jsonl`,
    hiddenRef: "refs/ralph-review/sessions/session-id/final",
    patchPath: `${projectPath}/.ralph-review/handoffs/session-id.patch`,
    sourceBaselineFingerprint: "fingerprint-1",
    commitSha: "commit-sha-1",
    state: "pending-apply",
    createdAt: 1,
    updatedAt: 1,
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

  test("accepts a unique handoff id prefix", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ handoffId: "session-alpha-handoff-1", sessionId: "session-alpha" }),
        createPendingHandoff({ handoffId: "session-beta-handoff-1", sessionId: "session-beta" }),
      ],
      selector: "session-alpha-h",
      action: "discard",
      isTTY: true,
    });

    expect(result.handoff?.sessionId).toBe("session-alpha");
    expect(result.handoff?.handoffId).toBe("session-alpha-handoff-1");
    expect(result.error).toBeUndefined();
  });

  test("falls back to a unique review session id selector", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ handoffId: "handoff-alpha-1", sessionId: "session-alpha" }),
        createPendingHandoff({ handoffId: "handoff-beta-1", sessionId: "session-beta" }),
      ],
      selector: "session-a",
      action: "discard",
      isTTY: true,
    });

    expect(result.handoff?.handoffId).toBe("handoff-alpha-1");
    expect(result.error).toBeUndefined();
  });

  test("returns an error when the handoff selector is ambiguous", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ handoffId: "session-alpha-handoff-1", sessionId: "session-alpha" }),
        createPendingHandoff({ handoffId: "session-atom-handoff-1", sessionId: "session-atom" }),
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

  test("returns an error when a review session id matches multiple handoffs", async () => {
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ handoffId: "handoff-1", sessionId: "session-shared" }),
        createPendingHandoff({ handoffId: "handoff-2", sessionId: "session-shared" }),
      ],
      selector: "session-shared",
      action: "apply",
      isTTY: false,
    });

    expect(result).toEqual({
      handoff: null,
      error: 'Session selector "session-shared" is ambiguous for the current project.',
    });
  });

  test("prompts when multiple handoffs exist in an interactive terminal", async () => {
    const prompts: string[] = [];
    const result = await resolvePendingHandoffSelection({
      handoffs: [
        createPendingHandoff({ handoffId: "handoff-alpha", sessionId: "session-alpha" }),
        createPendingHandoff({ handoffId: "handoff-beta", sessionId: "session-beta" }),
      ],
      action: "discard",
      isTTY: true,
      select: async (input) => {
        prompts.push(input.message);
        return "handoff-beta";
      },
    });

    expect(prompts).toEqual(["Choose a review handoff to discard"]);
    expect(result.handoff?.sessionId).toBe("session-beta");
    expect(result.handoff?.handoffId).toBe("handoff-beta");
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
