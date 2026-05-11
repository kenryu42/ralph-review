import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionWorktree, discardSessionWorktree } from "@/lib/git";
import {
  applyPendingHandoff,
  createOrAutoApplyHandoff,
  discardPendingHandoff,
  listProjectPendingHandoffs,
  readPendingHandoff,
} from "@/lib/handoff";
import { getProjectStorageDir } from "@/lib/logger";
import {
  createStorageBackedRepo,
  initTestRepoWithObjectFormat,
  removeStorageBackedRepo,
  runGitIn,
  runGitResult,
} from "../helpers/git";

async function writeFile(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}

function gitRefExists(repoPath: string, ref: string): boolean {
  return (
    Bun.spawnSync(["git", "show-ref", "--verify", "--quiet", ref], {
      cwd: repoPath,
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0
  );
}

describe("handoff", () => {
  let storageRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    ({ repoPath, storageRoot } = await createStorageBackedRepo(
      "ralph-handoff-storage-",
      "ralph-handoff-repo-"
    ));
  });

  afterEach(async () => {
    await removeStorageBackedRepo({ repoPath, storageRoot });
  });

  async function createPendingDivergedHandoff(
    sessionId: string,
    mutateRepoAfterStart?: () => Promise<void>
  ): Promise<string> {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, sessionId, storageRoot);
    let handoffId = "";
    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
      runGitIn(repoPath, ["add", "app.txt"]);
      runGitIn(repoPath, ["commit", "-m", "save draft"]);
      await mutateRepoAfterStart?.();

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId,
        projectPath: repoPath,
        logPath: join(storageRoot, "logs", `${sessionId}.jsonl`),
        worktree,
        autoApply: false,
      });

      expect(handoff?.handoffStatus).toBe("pending-apply");
      handoffId = handoff?.handoffId ?? "";
    } finally {
      discardSessionWorktree(worktree);
    }

    return handoffId;
  }

  function createHandoff(sessionId: string, worktree: ReturnType<typeof createSessionWorktree>) {
    return createOrAutoApplyHandoff(storageRoot, {
      sessionId,
      projectPath: repoPath,
      logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
      worktree,
    });
  }

  async function commitUserChangeAfterStart() {
    await writeFile(join(repoPath, "app.txt"), "user changed after start\n");
    runGitIn(repoPath, ["add", "app.txt"]);
    runGitIn(repoPath, ["commit", "-m", "user change"]);
  }

  async function expectAutoAppliedHandoff(
    handoff: Awaited<ReturnType<typeof createOrAutoApplyHandoff>>
  ) {
    expect(handoff).not.toBeNull();
    expect(handoff?.handoffStatus).toBe("applied-auto");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
    expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
  }

  async function createChangedWorktree(sessionId: string) {
    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const worktree = createSessionWorktree(repoPath, sessionId, storageRoot);
    await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
    await writeFile(join(repoPath, "app.txt"), "user changed after start\n");
    return worktree;
  }

  test("returns an empty list when the handoff directory does not exist yet", async () => {
    expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
  });

  test("auto-applies the sandbox result when the source repo still matches the session snapshot", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, "session-auto", storageRoot);
    expect(worktree.worktreeProjectPath.startsWith(`${storageRoot}/`)).toBe(true);
    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      const handoff = await createHandoff("session-auto", worktree);

      await expectAutoAppliedHandoff(handoff);
      expect(handoff?.commitSha).toBeString();
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("keeps a pending handoff when auto-apply is disabled", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, "session-pending-disabled", storageRoot);
    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-pending-disabled",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-pending-disabled.jsonl"),
        worktree,
        autoApply: false,
      });

      expect(handoff).not.toBeNull();
      expect(handoff?.handoffStatus).toBe("pending-apply");
      expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("draft\n");
      const pending = await listProjectPendingHandoffs(storageRoot, repoPath);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.sessionId).toBe("session-pending-disabled");
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("stores repeated handoffs for the same review session without overwriting", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const firstWorktree = createSessionWorktree(repoPath, "session-repeat", storageRoot);
    try {
      await writeFile(join(firstWorktree.worktreeProjectPath, "app.txt"), "fixed first\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-repeat",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-repeat.jsonl"),
        worktree: firstWorktree,
        autoApply: false,
      });

      expect(handoff?.handoffId).toStartWith("session-repeat-handoff-");
    } finally {
      discardSessionWorktree(firstWorktree);
    }

    const secondWorktree = createSessionWorktree(repoPath, "session-repeat", storageRoot);
    try {
      await writeFile(join(secondWorktree.worktreeProjectPath, "app.txt"), "fixed second\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-repeat",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-repeat.jsonl"),
        worktree: secondWorktree,
        autoApply: false,
      });

      expect(handoff?.handoffId).toStartWith("session-repeat-handoff-");
    } finally {
      discardSessionWorktree(secondWorktree);
    }

    const pending = await listProjectPendingHandoffs(storageRoot, repoPath);
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((artifact) => artifact.handoffId)).size).toBe(2);
    expect(pending.map((artifact) => artifact.sessionId)).toEqual([
      "session-repeat",
      "session-repeat",
    ]);
    expect(new Set(pending.map((artifact) => artifact.patchPath)).size).toBe(2);
    for (const artifact of pending) {
      expect(await Bun.file(artifact.patchPath).exists()).toBe(true);
    }
  });

  test("persists a pending handoff when the source repo changed after the session started", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const worktree = createSessionWorktree(repoPath, "session-pending", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
      await writeFile(join(repoPath, "app.txt"), "user changed after start\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-pending",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-pending.jsonl"),
        worktree,
      });

      expect(handoff?.handoffStatus).toBe("pending-apply");
      expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("user changed after start\n");

      const pending = await listProjectPendingHandoffs(storageRoot, repoPath);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.sessionId).toBe("session-pending");
      expect(pending[0]?.patchPath).toContain("session-pending");
      expect(await Bun.file(pending[0]?.patchPath ?? "").exists()).toBe(true);
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("auto-applies when only ignored files changed after the session started", async () => {
    await writeFile(join(repoPath, ".gitignore"), "*.local\n");
    runGitIn(repoPath, ["add", ".gitignore"]);
    runGitIn(repoPath, ["commit", "-m", "add ignore rule"]);

    await writeFile(join(repoPath, "app.txt"), "draft\n");
    await writeFile(join(repoPath, "cache.local"), "before\n");

    const worktree = createSessionWorktree(repoPath, "session-ignored-auto", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
      await writeFile(join(repoPath, "cache.local"), "after\n");

      const handoff = await createHandoff("session-ignored-auto", worktree);

      await expectAutoAppliedHandoff(handoff);
      expect(await Bun.file(join(repoPath, "cache.local")).text()).toBe("after\n");
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("persists a pending handoff when an untracked source path collides with a remediation add", async () => {
    const worktree = createSessionWorktree(repoPath, "session-untracked-collision", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "new.txt"), "from remediation\n");
      await writeFile(join(repoPath, "new.txt"), "user untracked file\n");

      const handoff = await createHandoff("session-untracked-collision", worktree);

      expect(handoff?.handoffStatus).toBe("pending-apply");
      expect(await Bun.file(join(repoPath, "new.txt")).text()).toBe("user untracked file\n");

      const pending = await listProjectPendingHandoffs(storageRoot, repoPath);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.sessionId).toBe("session-untracked-collision");
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("auto-applies in sha256 repositories when the source repo still matches the session baseline", async () => {
    await rm(repoPath, { recursive: true, force: true });
    repoPath = await mkdtemp(join(tmpdir(), "ralph-handoff-sha256-repo-"));
    initTestRepoWithObjectFormat(repoPath, "sha256");
    await writeFile(join(repoPath, "app.txt"), "base\n");
    runGitIn(repoPath, ["add", "app.txt"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);

    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, "session-sha256-auto", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      const handoff = await createHandoff("session-sha256-auto", worktree);

      await expectAutoAppliedHandoff(handoff);
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("applies a pending handoff when the repo matches the captured fingerprint", async () => {
    const worktree = await createChangedWorktree("session-manual");
    let handoffId = "";

    try {
      const handoff = await createHandoff("session-manual", worktree);
      handoffId = handoff?.handoffId ?? "";
    } finally {
      discardSessionWorktree(worktree);
    }

    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const applied = await applyPendingHandoff(storageRoot, repoPath, handoffId);
    expect(applied.sessionId).toBe("session-manual");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
    expect(await readPendingHandoff(storageRoot, repoPath, handoffId)).toBeNull();
  });

  test("applies a pending handoff when the repo has diverged cleanly", async () => {
    const handoffId = await createPendingDivergedHandoff("session-diverged-clean", async () => {
      await writeFile(join(repoPath, "other.txt"), "other change\n");
      runGitIn(repoPath, ["add", "other.txt"]);
      runGitIn(repoPath, ["commit", "-m", "other change"]);
    });

    const applied = await applyPendingHandoff(storageRoot, repoPath, handoffId);

    expect(applied.sessionId).toBe("session-diverged-clean");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
    expect(await readPendingHandoff(storageRoot, repoPath, handoffId)).toBeNull();
  });

  test("rejects apply when the repo has uncommitted changes on a divergent handoff", async () => {
    const handoffId = await createPendingDivergedHandoff("session-diverged-dirty");
    await writeFile(join(repoPath, "notes.txt"), "dirty working tree\n");

    await expect(applyPendingHandoff(storageRoot, repoPath, handoffId)).rejects.toThrow(
      "requires a clean working tree"
    );

    const pending = await readPendingHandoff(storageRoot, repoPath, handoffId);
    expect(pending?.state).toBe("pending-apply");
  });

  test("persists an apply-conflicted handoff when apply hits conflicts", async () => {
    const handoffId = await createPendingDivergedHandoff(
      "session-diverged-conflict",
      commitUserChangeAfterStart
    );

    await expect(applyPendingHandoff(storageRoot, repoPath, handoffId)).rejects.toThrow(
      "Resolve or abort the Git conflict"
    );

    const pending = await readPendingHandoff(storageRoot, repoPath, handoffId);
    expect(pending?.state).toBe("apply-conflicted");
    if (pending?.state === "apply-conflicted") {
      expect(pending.applyStartFingerprint).toBeString();
      expect(pending.applyStartedAt).toBeNumber();
    }
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toContain("<<<<<<<");
    expect(runGitResult(repoPath, ["ls-files", "--unmerged"]).stdout).toContain("app.txt");
  });

  test("cleans up an apply-conflicted handoff after manual conflict resolution", async () => {
    const handoffId = await createPendingDivergedHandoff(
      "session-diverged-resolved",
      commitUserChangeAfterStart
    );

    await expect(applyPendingHandoff(storageRoot, repoPath, handoffId)).rejects.toThrow(
      "Resolve or abort the Git conflict"
    );

    await writeFile(join(repoPath, "app.txt"), "resolved draft\n");
    runGitIn(repoPath, ["add", "app.txt"]);

    const pending = await readPendingHandoff(storageRoot, repoPath, handoffId);
    expect(pending).toBeNull();
  });

  test("restores an apply-conflicted handoff to pending after the user aborts the conflict", async () => {
    const handoffId = await createPendingDivergedHandoff(
      "session-diverged-aborted",
      commitUserChangeAfterStart
    );

    await expect(applyPendingHandoff(storageRoot, repoPath, handoffId)).rejects.toThrow(
      "Resolve or abort the Git conflict"
    );

    runGitIn(repoPath, ["reset", "--hard", "HEAD"]);

    const pending = await readPendingHandoff(storageRoot, repoPath, handoffId);
    expect(pending?.state).toBe("pending-apply");
  });

  test("discards a pending handoff without changing the source repo", async () => {
    const worktree = await createChangedWorktree("session-discard");
    let handoffId = "";

    try {
      const handoff = await createHandoff("session-discard", worktree);
      handoffId = handoff?.handoffId ?? "";
    } finally {
      discardSessionWorktree(worktree);
    }

    const discarded = await discardPendingHandoff(storageRoot, repoPath, handoffId);
    expect(discarded.sessionId).toBe("session-discard");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("user changed after start\n");
    expect(await readPendingHandoff(storageRoot, repoPath, handoffId)).toBeNull();
  });

  test("creates final handoff ref only after patch creation succeeds", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const sessionId = "session-patch-failure";
    const handoffId = `${sessionId}-handoff-fixed`;
    const worktree = createSessionWorktree(repoPath, sessionId, storageRoot);
    const patchPath = join(
      getProjectStorageDir(storageRoot, repoPath),
      "handoffs",
      `${handoffId}.patch`
    );
    await mkdir(patchPath, { recursive: true });

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      await expect(
        createOrAutoApplyHandoff(storageRoot, {
          sessionId,
          handoffId,
          projectPath: repoPath,
          logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
          worktree,
          autoApply: false,
        })
      ).rejects.toThrow();
    } finally {
      discardSessionWorktree(worktree);
    }

    expect(gitRefExists(repoPath, `refs/ralph-review/sessions/${handoffId}/final`)).toBe(false);
    expect(gitRefExists(repoPath, `refs/heads/${worktree.retainedBranch}`)).toBe(false);
  });
});
