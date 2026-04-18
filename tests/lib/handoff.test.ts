import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeWorkingTreeFingerprint,
  createSessionWorktree,
  discardSessionWorktree,
} from "@/lib/git";
import {
  applyPendingHandoff,
  createOrAutoApplyHandoff,
  discardPendingHandoff,
  listProjectArchivedHandoffs,
  listProjectPendingHandoffs,
  readPendingHandoff,
  reapplyArchivedHandoff,
  revertArchivedHandoff,
} from "@/lib/handoff";

function runGitIn(repoPath: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

async function writeFile(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}

function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

function initTestRepoWithObjectFormat(repoPath: string, objectFormat: "sha1" | "sha256"): void {
  runGitIn(repoPath, ["init", `--object-format=${objectFormat}`, "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

describe("handoff", () => {
  let storageRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "ralph-handoff-storage-"));
    repoPath = await mkdtemp(join(tmpdir(), "ralph-handoff-repo-"));
    initTestRepo(repoPath);
    await writeFile(join(repoPath, "app.txt"), "base\n");
    runGitIn(repoPath, ["add", "app.txt"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(repoPath, { recursive: true, force: true });
  });

  test("returns an empty list when the handoff directory does not exist yet", async () => {
    expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
  });

  test("auto-applies the sandbox result when the source repo still matches the session snapshot", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, "session-auto", storageRoot);
    expect(worktree.worktreeProjectPath.startsWith(`${storageRoot}/`)).toBe(true);
    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-auto",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-auto.jsonl"),
        worktree,
      });

      expect(handoff).not.toBeNull();
      expect(handoff?.handoffStatus).toBe("applied-auto");
      expect(handoff?.commitSha).toBeString();
      expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
      expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
      const archived = await listProjectArchivedHandoffs(storageRoot, repoPath);
      expect(archived).toHaveLength(1);
      expect(archived[0]?.sessionId).toBe("session-auto");
      expect(archived[0]?.appliedVia).toBe("auto");
      expect(archived[0]?.appliedFingerprint).toBe(computeWorkingTreeFingerprint(repoPath));
      expect(await Bun.file(archived[0]?.patchPath ?? "").exists()).toBe(true);
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
      expect(await listProjectArchivedHandoffs(storageRoot, repoPath)).toEqual([]);
    } finally {
      discardSessionWorktree(worktree);
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

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-ignored-auto",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-ignored-auto.jsonl"),
        worktree,
      });

      expect(handoff).not.toBeNull();
      expect(handoff?.handoffStatus).toBe("applied-auto");
      expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
      expect(await Bun.file(join(repoPath, "cache.local")).text()).toBe("after\n");
      expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("persists a pending handoff when an untracked source path collides with a remediation add", async () => {
    const worktree = createSessionWorktree(repoPath, "session-untracked-collision", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "new.txt"), "from remediation\n");
      await writeFile(join(repoPath, "new.txt"), "user untracked file\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-untracked-collision",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-untracked-collision.jsonl"),
        worktree,
      });

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

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-sha256-auto",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-sha256-auto.jsonl"),
        worktree,
      });

      expect(handoff).not.toBeNull();
      expect(handoff?.handoffStatus).toBe("applied-auto");
      expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
      expect(await listProjectPendingHandoffs(storageRoot, repoPath)).toEqual([]);
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("applies a pending handoff only when the repo matches the captured fingerprint", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const worktree = createSessionWorktree(repoPath, "session-manual", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
      await writeFile(join(repoPath, "app.txt"), "user changed after start\n");

      await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-manual",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-manual.jsonl"),
        worktree,
      });
    } finally {
      discardSessionWorktree(worktree);
    }

    await expect(applyPendingHandoff(storageRoot, repoPath, "session-manual")).rejects.toThrow(
      "Current repository state no longer matches the saved review baseline."
    );

    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const applied = await applyPendingHandoff(storageRoot, repoPath, "session-manual");
    expect(applied.sessionId).toBe("session-manual");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
    expect(await readPendingHandoff(storageRoot, repoPath, "session-manual")).toBeNull();
    const archived = await listProjectArchivedHandoffs(storageRoot, repoPath);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.sessionId).toBe("session-manual");
    expect(archived[0]?.appliedVia).toBe("manual");
  });

  test("discards a pending handoff without changing the source repo", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");
    const worktree = createSessionWorktree(repoPath, "session-discard", storageRoot);

    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");
      await writeFile(join(repoPath, "app.txt"), "user changed after start\n");

      await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-discard",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-discard.jsonl"),
        worktree,
      });
    } finally {
      discardSessionWorktree(worktree);
    }

    const discarded = await discardPendingHandoff(storageRoot, repoPath, "session-discard");
    expect(discarded.sessionId).toBe("session-discard");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("user changed after start\n");
    expect(await readPendingHandoff(storageRoot, repoPath, "session-discard")).toBeNull();
    expect(await listProjectArchivedHandoffs(storageRoot, repoPath)).toEqual([]);
  });

  test("reverts and reapplies an archived handoff only from its matching fingerprints", async () => {
    await writeFile(join(repoPath, "app.txt"), "draft\n");

    const worktree = createSessionWorktree(repoPath, "session-replay", storageRoot);
    try {
      await writeFile(join(worktree.worktreeProjectPath, "app.txt"), "fixed draft\n");

      const handoff = await createOrAutoApplyHandoff(storageRoot, {
        sessionId: "session-replay",
        projectPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", "session-replay.jsonl"),
        worktree,
      });

      expect(handoff?.handoffStatus).toBe("applied-auto");
    } finally {
      discardSessionWorktree(worktree);
    }

    await expect(reapplyArchivedHandoff(storageRoot, repoPath, "session-replay")).rejects.toThrow(
      'Archived review handoff "session-replay" cannot be reapplied because the current repository state does not match its source baseline.'
    );

    const reverted = await revertArchivedHandoff(storageRoot, repoPath, "session-replay");
    expect(reverted.sessionId).toBe("session-replay");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("draft\n");

    await expect(revertArchivedHandoff(storageRoot, repoPath, "session-replay")).rejects.toThrow(
      'Archived review handoff "session-replay" cannot be reverted because the current repository state does not match its applied baseline.'
    );

    const reapplied = await reapplyArchivedHandoff(storageRoot, repoPath, "session-replay");
    expect(reapplied.sessionId).toBe("session-replay");
    expect(await Bun.file(join(repoPath, "app.txt")).text()).toBe("fixed draft\n");
  });

  test("keeps only the newest five archived handoffs per project", async () => {
    for (let index = 1; index <= 6; index++) {
      await writeFile(join(repoPath, "app.txt"), `draft ${index}\n`);

      const worktree = createSessionWorktree(repoPath, `session-${index}`, storageRoot);
      try {
        await writeFile(join(worktree.worktreeProjectPath, "app.txt"), `fixed ${index}\n`);

        const handoff = await createOrAutoApplyHandoff(storageRoot, {
          sessionId: `session-${index}`,
          projectPath: repoPath,
          logPath: join(repoPath, ".ralph-review", "logs", `session-${index}.jsonl`),
          worktree,
        });

        expect(handoff?.handoffStatus).toBe("applied-auto");
      } finally {
        discardSessionWorktree(worktree);
      }

      await Bun.sleep(2);
    }

    const archived = await listProjectArchivedHandoffs(storageRoot, repoPath);
    expect(archived).toHaveLength(5);
    expect(archived.map((artifact) => artifact.sessionId)).toEqual([
      "session-6",
      "session-5",
      "session-4",
      "session-3",
      "session-2",
    ]);
  });
});
