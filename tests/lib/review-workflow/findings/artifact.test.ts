import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFixResults,
  computeSnapshotFingerprint,
  getFindingsArtifactPath,
  getReviewedSnapshotPath,
  loadFindingsArtifact,
  loadFindingsArtifactBySessionId,
  persistReviewedSnapshot,
  saveFindingsArtifact,
  updateAuditSummary,
  updateSelection,
  validateArtifactSnapshot,
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
      sourceFingerprint: "fingerprint-1",
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

  test("persists reviewed snapshots under project storage and keeps them immutable", async () => {
    const sourceSnapshotPath = join(tempDir, "source-snapshot");
    await Bun.write(join(sourceSnapshotPath, "src/file.ts"), "export const value = 1;\n", {
      createPath: true,
    });

    const persisted = await persistReviewedSnapshot(
      tempDir,
      "/repo/project",
      "session-snapshot",
      sourceSnapshotPath
    );

    expect(persisted.reviewedSnapshotPath).toBe(
      getReviewedSnapshotPath(tempDir, "/repo/project", "session-snapshot")
    );
    expect(await Bun.file(join(persisted.reviewedSnapshotPath, "src/file.ts")).text()).toBe(
      "export const value = 1;\n"
    );
    expect(persisted.sourceFingerprint).toBe(
      await computeSnapshotFingerprint(persisted.reviewedSnapshotPath)
    );

    await Bun.write(join(sourceSnapshotPath, "src/file.ts"), "export const value = 2;\n");
    expect(await Bun.file(join(persisted.reviewedSnapshotPath, "src/file.ts")).text()).toBe(
      "export const value = 1;\n"
    );
  });

  test("updates selection, fix results, and audit summary", async () => {
    const snapshotPath = join(tempDir, "snapshot-selection");
    await Bun.write(join(snapshotPath, "README.md"), "snapshot file", { createPath: true });

    const sourceFingerprint = await computeSnapshotFingerprint(snapshotPath);
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-select",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-select.jsonl",
      reviewedSnapshotRef: "def456",
      reviewedSnapshotPath: snapshotPath,
      sourceFingerprint,
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
    const sourceSnapshotPath = join(tempDir, "lookup-source-snapshot");
    await Bun.write(join(sourceSnapshotPath, "README.md"), "snapshot file\n", {
      createPath: true,
    });

    const persisted = await persistReviewedSnapshot(
      tempDir,
      "/repo/project-a",
      "session-lookup",
      sourceSnapshotPath
    );
    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-lookup",
      projectPath: "/repo/project-a",
      logPath: "/tmp/logs/session-lookup.jsonl",
      reviewedSnapshotRef: "lookup-ref",
      reviewedSnapshotPath: persisted.reviewedSnapshotPath,
      sourceFingerprint: persisted.sourceFingerprint,
      findings: [createStoredFinding("F001")],
      selectedFindingIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await saveFindingsArtifact(tempDir, artifact);

    const loaded = await loadFindingsArtifactBySessionId(tempDir, "session-lookup");

    expect(loaded).not.toBeNull();
    expect(loaded?.projectPath).toBe("/repo/project-a");
    expect(loaded?.sessionId).toBe("session-lookup");
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
      sourceFingerprint: "fingerprint-1",
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

    await expect(validateArtifactSnapshot(loaded)).rejects.toThrow(
      "Reviewed snapshot path is missing"
    );
  });

  test("fails when snapshot fingerprint does not match", async () => {
    const snapshotPath = join(tempDir, "snapshot-fingerprint");
    await Bun.write(join(snapshotPath, "src/file.ts"), "const value = 1;", { createPath: true });

    const artifact: FindingsArtifact = {
      artifactVersion: 1,
      sessionId: "session-fingerprint-mismatch",
      projectPath: "/repo/project",
      logPath: "/tmp/logs/session-fingerprint-mismatch.jsonl",
      reviewedSnapshotRef: "snap-2",
      reviewedSnapshotPath: snapshotPath,
      sourceFingerprint: "not-the-real-fingerprint",
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

    await expect(validateArtifactSnapshot(loaded)).rejects.toThrow(
      "Reviewed snapshot fingerprint mismatch"
    );
  });
});
