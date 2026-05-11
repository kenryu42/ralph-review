import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBaselineCommit } from "@/lib/git";
import {
  appendFixResults,
  getFindingsArtifactPath,
  loadFindingsArtifact,
  loadFindingsArtifactBySessionId,
  saveFindingsArtifact,
  updateSelection,
  validateArtifactBaseline,
} from "@/lib/review-workflow/findings/artifact";
import type {
  FindingFixResult,
  FindingId,
  FindingsArtifact,
  StoredFinding,
} from "@/lib/review-workflow/findings/types";
import { initTestRepo, runGitIn } from "../../../helpers/git";

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

function createArtifact(
  repoPath: string,
  baseline: ReturnType<typeof createBaselineCommit>
): FindingsArtifact {
  return {
    artifactVersion: 1,
    sessionId: "session-123",
    projectPath: repoPath,
    logPath: "/tmp/logs/session-123.jsonl",
    baselineRef: baseline.ref,
    baselineCommitSha: baseline.commitSha,
    sourceBaselineRef: baseline.ref.replace(/\/baseline$/u, "/source"),
    sourceBaselineCommitSha: baseline.commitSha,
    sourceBaselineFingerprint: baseline.fingerprint,
    findings: [createStoredFinding("F001")],
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

  async function createRepoArtifact() {
    const repoPath = join(tempDir, "repo");
    await mkdir(repoPath, { recursive: true });
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, "src/file.ts"), "export const value = 1;\n", {
      createPath: true,
    });
    runGitIn(repoPath, ["add", "src/file.ts"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);

    const baseline = createBaselineCommit(repoPath, "session-123");
    return {
      repoPath,
      baseline,
      artifact: createArtifact(repoPath, baseline),
    };
  }

  test("round-trips git-based artifacts and resolves the project-scoped path", async () => {
    const { repoPath, baseline, artifact } = await createRepoArtifact();
    const artifactPath = getFindingsArtifactPath(tempDir, repoPath, artifact.sessionId);

    await saveFindingsArtifact(tempDir, artifact);
    const loaded = await loadFindingsArtifact(tempDir, repoPath, artifact.sessionId);

    expect(artifactPath).toContain("findings/session-123.json");
    expect(loaded?.baselineCommitSha).toBe(baseline.commitSha);
    expect(loaded?.sourceBaselineFingerprint).toBe(baseline.fingerprint);
    expect(loaded?.findings.map((finding) => finding.id)).toEqual(["F001"]);
  });

  test("updates selection and fix results on stored artifacts", async () => {
    const { repoPath, artifact } = await createRepoArtifact();
    await saveFindingsArtifact(tempDir, artifact);

    const selection = await updateSelection(tempDir, repoPath, "session-123", ["F001"]);
    expect(selection.selectedFindingIds).toEqual(["F001"]);

    const fixResults: FindingFixResult[] = [
      {
        findingId: "F001",
        status: "skipped",
        summary: "SKIP: false positive",
      },
    ];
    const withFixes = await appendFixResults(tempDir, repoPath, "session-123", fixResults);
    expect(withFixes.fixResults).toEqual(fixResults);
  });

  test("loads a single artifact by session id across project storage", async () => {
    const { repoPath, artifact } = await createRepoArtifact();
    await saveFindingsArtifact(tempDir, artifact);

    const loaded = await loadFindingsArtifactBySessionId(tempDir, "session-123");
    expect(loaded?.projectPath).toBe(repoPath);
  });

  test("validates that the artifact baseline commit is still reachable", async () => {
    const { baseline, artifact: storedArtifact } = await createRepoArtifact();
    const artifact = await saveFindingsArtifact(tempDir, storedArtifact);

    await expect(validateArtifactBaseline(artifact)).resolves.toEqual({
      baselineCommitSha: baseline.commitSha,
    });

    await expect(
      validateArtifactBaseline({
        ...artifact,
        baselineCommitSha: "deadbeef",
      })
    ).rejects.toThrow("Baseline commit deadbeef not found");
  });
});
