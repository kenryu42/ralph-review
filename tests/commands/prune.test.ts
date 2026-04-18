import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommandDef } from "@/cli";
import { runPrune } from "@/commands/prune";
import { parseCommand } from "@/lib/cli-parser";
import {
  getFindingsArtifactPath,
  saveFindingsArtifact,
} from "@/lib/review-workflow/findings/artifact";
import type { FindingsArtifact, StoredFinding } from "@/lib/review-workflow/findings/types";

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

function gitExitCode(repoPath: string, args: string[]): number {
  return Bun.spawnSync(["git", ...args], {
    cwd: repoPath,
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode;
}

function initTestRepo(repoPath: string): void {
  runGitIn(repoPath, ["init", "--initial-branch=main"]);
  runGitIn(repoPath, ["config", "core.autocrlf", "false"]);
  runGitIn(repoPath, ["config", "user.name", "Tester"]);
  runGitIn(repoPath, ["config", "user.email", "test@example.com"]);
  runGitIn(repoPath, ["config", "commit.gpgsign", "false"]);
}

function createFinding(id: StoredFinding["id"]): StoredFinding {
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

function createArtifact(repoPath: string, sessionId: string, updatedAt: string): FindingsArtifact {
  const normalizedSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-");

  return {
    artifactVersion: 1,
    sessionId,
    projectPath: repoPath,
    logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
    baselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/baseline`,
    baselineCommitSha: "baseline-sha-123",
    sourceBaselineRef: `refs/ralph-review/sessions/${normalizedSessionId}/source`,
    sourceBaselineCommitSha: "source-baseline-sha-123",
    sourceBaselineFingerprint: "tracked-fingerprint-1",
    findings: [createFinding("F001")],
    selectedFindingIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

async function writeArchivedHandoff(
  storageRoot: string,
  repoPath: string,
  sessionId: string,
  appliedAt: number
): Promise<{ metadataPath: string; patchPath: string }> {
  const projectStorageDir = getFindingsArtifactPath(storageRoot, repoPath, sessionId).replace(
    /\/findings\/[^/]+$/u,
    ""
  );
  const patchPath = join(projectStorageDir, "handoff-history", `${sessionId}.patch`);
  const metadataPath = join(projectStorageDir, "handoff-history", `${sessionId}.json`);

  await Bun.write(patchPath, "diff --git a/app.txt b/app.txt\n", { createPath: true });
  await Bun.write(
    metadataPath,
    JSON.stringify(
      {
        sessionId,
        projectPath: repoPath,
        sourceRepoPath: repoPath,
        logPath: join(repoPath, ".ralph-review", "logs", `${sessionId}.jsonl`),
        patchPath,
        sourceBaselineFingerprint: "tracked-fingerprint-1",
        appliedFingerprint: "tracked-fingerprint-2",
        commitSha: "commit-sha-1",
        appliedVia: "manual",
        state: "archived-applied",
        createdAt: appliedAt - 1_000,
        appliedAt,
      },
      null,
      2
    ),
    { createPath: true }
  );

  return { metadataPath, patchPath };
}

async function listPendingFromStorage(): Promise<[]> {
  return [];
}

async function listArchivedFromStorage(
  storageRoot: string | undefined,
  projectPath: string
): Promise<
  Array<{
    sessionId: string;
    projectPath: string;
    sourceRepoPath: string;
    logPath: string;
    patchPath: string;
    sourceBaselineFingerprint: string;
    appliedFingerprint: string;
    commitSha: string;
    appliedVia: "auto" | "manual";
    state: "archived-applied";
    createdAt: number;
    appliedAt: number;
  }>
> {
  type ArchivedRecord = {
    sessionId: string;
    projectPath: string;
    sourceRepoPath: string;
    logPath: string;
    patchPath: string;
    sourceBaselineFingerprint: string;
    appliedFingerprint: string;
    commitSha: string;
    appliedVia: "auto" | "manual";
    state: "archived-applied";
    createdAt: number;
    appliedAt: number;
  };
  const historyDir = getFindingsArtifactPath(storageRoot ?? "", projectPath, "placeholder").replace(
    /\/findings\/[^/]+$/u,
    "/handoff-history"
  );
  const entries = await readdir(historyDir).catch(() => []);
  const artifacts: ArchivedRecord[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const candidate = await Bun.file(join(historyDir, entry))
      .json()
      .catch(() => null);
    if (candidate && typeof candidate === "object") {
      artifacts.push(candidate as ArchivedRecord);
    }
  }

  return artifacts;
}

describe("prune command", () => {
  let storageRoot: string;
  let repoPath: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "ralph-prune-storage-"));
    repoPath = await mkdtemp(join(tmpdir(), "ralph-prune-repo-"));
    initTestRepo(repoPath);
    await Bun.write(join(repoPath, "app.txt"), "base\n");
    runGitIn(repoPath, ["add", "app.txt"]);
    runGitIn(repoPath, ["commit", "-m", "initial commit"]);
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(repoPath, { recursive: true, force: true });
  });

  test("dry-run lists prunable applied sessions without deleting files", async () => {
    const sessionId = "session-applied";
    const infos: string[] = [];
    const successes: string[] = [];
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    const archived = await writeArchivedHandoff(
      storageRoot,
      repoPath,
      sessionId,
      1_700_000_000_000
    );
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });

    await runPrune([], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      listProjectArchivedHandoffs: listArchivedFromStorage,
      logInfo: (message) => infos.push(message),
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(infos.some((message) => message.includes(sessionId))).toBe(true);
    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      true
    );
    expect(await Bun.file(archived.metadataPath).exists()).toBe(true);
    expect(await Bun.file(artifact.logPath).exists()).toBe(true);
    expect(successes).toEqual([]);
  });

  test("apply removes prunable session files and refs but keeps archived history by default", async () => {
    const sessionId = "session-applied";
    const successes: string[] = [];
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    const archived = await writeArchivedHandoff(
      storageRoot,
      repoPath,
      sessionId,
      1_700_000_000_000
    );
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });
    runGitIn(repoPath, ["update-ref", artifact.baselineRef, "HEAD"]);
    runGitIn(repoPath, ["update-ref", "refs/ralph-review/sessions/session-applied/final", "HEAD"]);

    await runPrune(["--apply"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      listProjectArchivedHandoffs: listArchivedFromStorage,
      logInfo: () => {},
      logSuccess: (message) => successes.push(message),
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(await Bun.file(artifact.logPath).exists()).toBe(false);
    expect(await Bun.file(archived.metadataPath).exists()).toBe(true);
    expect(await Bun.file(archived.patchPath).exists()).toBe(true);
    expect(gitExitCode(repoPath, ["show-ref", "--verify", artifact.baselineRef])).not.toBe(0);
    expect(
      gitExitCode(repoPath, [
        "show-ref",
        "--verify",
        "refs/ralph-review/sessions/session-applied/final",
      ])
    ).not.toBe(0);
    expect(successes.at(-1)).toContain("Pruned 1 review session");
  });

  test("older-than filters the prunable set", async () => {
    const oldSessionId = "session-old";
    const newSessionId = "session-new";
    await saveFindingsArtifact(
      storageRoot,
      createArtifact(repoPath, oldSessionId, "2026-01-01T00:00:00.000Z")
    );
    await saveFindingsArtifact(
      storageRoot,
      createArtifact(repoPath, newSessionId, "2026-04-10T00:00:00.000Z")
    );
    await writeArchivedHandoff(storageRoot, repoPath, oldSessionId, 1_700_000_000_000);
    await writeArchivedHandoff(storageRoot, repoPath, newSessionId, 1_799_000_000_000);

    const infos: string[] = [];
    await runPrune(["--older-than", "14d"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      listProjectArchivedHandoffs: listArchivedFromStorage,
      logInfo: (message) => infos.push(message),
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(infos.some((message) => message.includes(oldSessionId))).toBe(true);
    expect(infos.some((message) => message.includes(newSessionId))).toBe(false);
  });

  test("force session apply removes archived history too", async () => {
    const sessionId = "session-force";
    const artifact = createArtifact(repoPath, sessionId, "2026-01-01T00:00:00.000Z");
    await saveFindingsArtifact(storageRoot, artifact);
    const archived = await writeArchivedHandoff(
      storageRoot,
      repoPath,
      sessionId,
      1_700_000_000_000
    );
    await Bun.write(artifact.logPath, "session log\n", { createPath: true });

    await runPrune(["--session", sessionId, "--force", "--apply"], {
      getCommandDef,
      parseCommand,
      cwd: () => repoPath,
      storageRoot,
      listProjectPendingHandoffs: listPendingFromStorage,
      listProjectArchivedHandoffs: listArchivedFromStorage,
      logInfo: () => {},
      logSuccess: () => {},
      logWarn: () => {},
      logError: () => {},
      exit: () => {},
      now: () => 1_800_000_000_000,
    });

    expect(await Bun.file(getFindingsArtifactPath(storageRoot, repoPath, sessionId)).exists()).toBe(
      false
    );
    expect(await Bun.file(artifact.logPath).exists()).toBe(false);
    expect(await Bun.file(archived.metadataPath).exists()).toBe(false);
    expect(await Bun.file(archived.patchPath).exists()).toBe(false);
  });
});
