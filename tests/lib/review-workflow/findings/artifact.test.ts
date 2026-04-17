import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionWorktree, discardSessionWorktree } from "@/lib/git";
import {
  appendFixResults,
  computeSnapshotFingerprint,
  getFindingsArtifactPath,
  getHandoffSnapshotPath,
  getReviewedSnapshotPath,
  loadFindingsArtifact,
  loadFindingsArtifactBySessionId,
  persistDiscoverySnapshots,
  saveFindingsArtifact,
  updateAuditSummary,
  updateSelection,
  validateArtifactSnapshots,
} from "@/lib/review-workflow/findings/artifact";
import type {
  AuditSummary,
  FindingFixResult,
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";

function createStoredFinding(id: FindingId): StoredFinding {
  return {
    id,
    fingerprint: `fp-${id}`,
    locationKey: `src/file-${id}.ts:1:1`,
    title: `Finding ${id}`,
    body: `Body for ${id}`,
    priority: "P1",
    confidenceScore: 0.5,
    filePath: `src/file-${id}.ts`,
    startLine: 1,
    endLine: 1,
  };
}

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

function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

describe("review-workflow/findings/artifact", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralph-findings-artifact-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("round-trips artifact read/write and resolves project-scoped path", async () => {
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-123",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-123.jsonl",
      reviewedSnapshotRef: "abc123",
      reviewedSnapshotPath: join(tempDir, "snapshot"),
      reviewedSnapshotFingerprint: "reviewed-fingerprint-1",
      handoffSnapshotPath: join(tempDir, "handoff"),
      handoffSnapshotFingerprint: "handoff-fingerprint-1",
      sourceRepoFingerprint: "repo-fingerprint-1",
      findings: [createStoredFinding("F001")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const artifactPath = getFindingsArtifactPath(tempDir, artifact.projectPath, artifact.sessionId);
    await saveFindingsArtifact(tempDir, artifact);

    const loaded = await loadFindingsArtifact(tempDir, artifact.projectPath, artifact.sessionId);

    expect(artifactPath).toContain("findings/session-123.json");
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("session-123");
    expect(loaded?.findings.map((finding) => finding.id)).toEqual(["F001"]);
  });

  test("persists reviewed and handoff snapshots under project storage and keeps them immutable", async () => {
    const repoPath = join(tempDir, "repo");
    await mkdir(repoPath, { recursive: true });
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, "src/file.ts"), "export const value = 1;\n", {
      createPath: true,
    });
    await Bun.write(join(repoPath, "cache.local"), "ignored\n");
    await Bun.write(join(repoPath, ".gitignore"), "*.local\n");
    runGitIn(repoPath, ["add", "src/file.ts", ".gitignore"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);

    const worktree = createSessionWorktree(repoPath, "session-snapshot", tempDir);

    try {
      const persisted = await persistDiscoverySnapshots(tempDir, repoPath, "session-snapshot", {
        reviewedSnapshotSourcePath: repoPath,
        handoffSnapshotSourceDir: worktree.sourceSnapshotDir ?? "",
        sourceRepoFingerprint: worktree.sourceFingerprint ?? "",
      });

      expect(persisted.reviewedSnapshotPath).toBe(
        getReviewedSnapshotPath(tempDir, repoPath, "session-snapshot")
      );
      expect(persisted.handoffSnapshotPath).toBe(
        getHandoffSnapshotPath(tempDir, repoPath, "session-snapshot")
      );
      expect(await Bun.file(join(persisted.reviewedSnapshotPath, "src/file.ts")).text()).toBe(
        "export const value = 1;\n"
      );
      expect(persisted.reviewedSnapshotFingerprint).toBe(
        await computeSnapshotFingerprint(persisted.reviewedSnapshotPath)
      );
      expect(persisted.handoffSnapshotFingerprint).toBe(
        await computeSnapshotFingerprint(persisted.handoffSnapshotPath)
      );
      expect(await Bun.file(join(persisted.handoffSnapshotPath, "cache.local")).exists()).toBe(
        false
      );
      const sourceRepoFingerprint = worktree.sourceFingerprint;
      if (!sourceRepoFingerprint) {
        throw new Error("Expected worktree source fingerprint");
      }
      expect(persisted.sourceRepoFingerprint).toBe(sourceRepoFingerprint);

      await Bun.write(join(repoPath, "src/file.ts"), "export const value = 2;\n");
      expect(await Bun.file(join(persisted.reviewedSnapshotPath, "src/file.ts")).text()).toBe(
        "export const value = 1;\n"
      );
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("updates selection, fix results, and audit summary", async () => {
    const snapshotPath = join(tempDir, "snapshot-selection");
    await Bun.write(join(snapshotPath, "README.md"), "snapshot file", { createPath: true });

    const reviewedSnapshotFingerprint = await computeSnapshotFingerprint(snapshotPath);
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-select",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-select.jsonl",
      reviewedSnapshotRef: "def456",
      reviewedSnapshotPath: snapshotPath,
      reviewedSnapshotFingerprint,
      handoffSnapshotPath: snapshotPath,
      handoffSnapshotFingerprint: reviewedSnapshotFingerprint,
      sourceRepoFingerprint: "repo-fingerprint-1",
      findings: [createStoredFinding("F001"), createStoredFinding("F002")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await saveFindingsArtifact(tempDir, artifact);

    const selected = await updateSelection(tempDir, artifact.projectPath, artifact.sessionId, [
      "F002",
      "F001",
      "F002",
    ]);

    expect(selected.selectedFindingIds).toEqual(["F001", "F002"]);

    const fixResults: FindingFixResult[] = [
      {
        findingId: "F001",
        status: "fixed",
        summary: "Applied guard",
      },
    ];

    const withFixes = await appendFixResults(
      tempDir,
      artifact.projectPath,
      artifact.sessionId,
      fixResults
    );

    expect(withFixes.fixResults).toHaveLength(1);
    expect(withFixes.fixResults?.[0]?.findingId).toBe("F001");

    const audit: AuditSummary = {
      resolvedFindingIds: ["F001"],
      unresolvedFindingIds: ["F002"],
      regressionFindings: [createStoredFinding("F900")],
      summary: "One unresolved finding remains",
    };

    const withAudit = await updateAuditSummary(
      tempDir,
      artifact.projectPath,
      artifact.sessionId,
      audit
    );

    expect(withAudit.latestAudit?.resolvedFindingIds).toEqual(["F001"]);
    expect(withAudit.latestAudit?.unresolvedFindingIds).toEqual(["F002"]);
    expect(withAudit.latestAudit?.regressionFindings.map((finding) => finding.id)).toEqual([
      "F900",
    ]);
  });

  test("loads an artifact by session id across project storage", async () => {
    const repoPath = join(tempDir, "lookup-repo");
    await mkdir(repoPath, { recursive: true });
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, "app.ts"), "export const value = 1;\n", {
      createPath: true,
    });
    runGitIn(repoPath, ["add", "app.ts"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);
    const worktree = createSessionWorktree(repoPath, "session-lookup", tempDir);
    const persisted = await persistDiscoverySnapshots(tempDir, repoPath, "session-lookup", {
      reviewedSnapshotSourcePath: repoPath,
      handoffSnapshotSourceDir: worktree.sourceSnapshotDir ?? "",
      sourceRepoFingerprint: worktree.sourceFingerprint ?? "",
    });
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-lookup",
      projectPath: "/repo/project-a",
      logPath: "/tmp/logs/session-lookup.jsonl",
      reviewedSnapshotRef: "lookup-ref",
      reviewedSnapshotPath: persisted.reviewedSnapshotPath,
      reviewedSnapshotFingerprint: persisted.reviewedSnapshotFingerprint,
      handoffSnapshotPath: persisted.handoffSnapshotPath,
      handoffSnapshotFingerprint: persisted.handoffSnapshotFingerprint,
      sourceRepoFingerprint: persisted.sourceRepoFingerprint,
      findings: [createStoredFinding("F001")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    try {
      await saveFindingsArtifact(tempDir, artifact);

      const loaded = await loadFindingsArtifactBySessionId(tempDir, "session-lookup");

      expect(loaded).not.toBeNull();
      expect(loaded?.projectPath).toBe("/repo/project-a");
      expect(loaded?.sessionId).toBe("session-lookup");
    } finally {
      discardSessionWorktree(worktree);
    }
  });

  test("fails when artifact is missing", async () => {
    await expect(
      updateSelection(tempDir, "/repo/project", "missing-session", ["F001"])
    ).rejects.toThrow("Findings artifact not found");
  });

  test("fails when snapshot path is missing", async () => {
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-missing-snapshot",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-missing-snapshot.jsonl",
      reviewedSnapshotRef: "snap-1",
      reviewedSnapshotPath: join(tempDir, "does-not-exist"),
      reviewedSnapshotFingerprint: "reviewed-fingerprint-1",
      handoffSnapshotPath: join(tempDir, "does-not-exist-handoff"),
      handoffSnapshotFingerprint: "handoff-fingerprint-1",
      sourceRepoFingerprint: "repo-fingerprint-1",
      findings: [createStoredFinding("F001")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await saveFindingsArtifact(tempDir, artifact);

    const loaded = await loadFindingsArtifact(tempDir, artifact.projectPath, artifact.sessionId);
    if (!loaded) {
      throw new Error("Expected artifact to load");
    }

    await expect(validateArtifactSnapshots(loaded)).rejects.toThrow(
      "Reviewed snapshot path is missing"
    );
  });

  test("fails when either snapshot fingerprint does not match", async () => {
    const snapshotPath = join(tempDir, "snapshot-fingerprint");
    await Bun.write(join(snapshotPath, "src/file.ts"), "const value = 1;", { createPath: true });
    const handoffSnapshotPath = join(tempDir, "handoff-fingerprint");
    await Bun.write(join(handoffSnapshotPath, "src/file.ts"), "const value = 1;", {
      createPath: true,
    });

    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-fingerprint-mismatch",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-fingerprint-mismatch.jsonl",
      reviewedSnapshotRef: "snap-2",
      reviewedSnapshotPath: snapshotPath,
      reviewedSnapshotFingerprint: "not-the-real-reviewed-fingerprint",
      handoffSnapshotPath,
      handoffSnapshotFingerprint: "not-the-real-handoff-fingerprint",
      sourceRepoFingerprint: "repo-fingerprint-1",
      findings: [createStoredFinding("F001")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await saveFindingsArtifact(tempDir, artifact);

    const loaded = await loadFindingsArtifact(tempDir, artifact.projectPath, artifact.sessionId);
    if (!loaded) {
      throw new Error("Expected artifact to load");
    }

    await expect(validateArtifactSnapshots(loaded)).rejects.toThrow(
      "Reviewed snapshot fingerprint mismatch"
    );
  });

  test("rejects legacy single-snapshot artifacts even when artifactVersion stays at 1", async () => {
    const artifactPath = getFindingsArtifactPath(tempDir, "/repo/project", "legacy-session");
    await Bun.write(
      artifactPath,
      JSON.stringify(
        {
          artifactVersion: 1,
          sessionId: "legacy-session",
          projectPath: "/repo/project",
          logPath: "/tmp/logs/legacy-session.jsonl",
          reviewedSnapshotRef: "legacy-ref",
          reviewedSnapshotPath: "/tmp/reviewed",
          sourceFingerprint: "legacy-fingerprint",
          findings: [createStoredFinding("F001")],
          selectedFindingIds: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2
      ),
      { createPath: true }
    );

    await expect(loadFindingsArtifact(tempDir, "/repo/project", "legacy-session")).rejects.toThrow(
      "Findings artifact has invalid schema"
    );
  });
});
