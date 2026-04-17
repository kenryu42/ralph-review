import type { GitSessionWorktree } from "@/lib/git";
import type { persistDiscoverySnapshots as persistDiscoverySnapshotsType } from "@/lib/review-workflow/findings/artifact";

export interface FrozenDiscoverySnapshots {
  reviewedSnapshotPath: string;
  reviewedSnapshotRef: string;
  reviewedSnapshotFingerprint: string;
  handoffSnapshotPath: string;
  handoffSnapshotFingerprint: string;
  sourceRepoFingerprint: string;
}

export async function freezeDiscoverySnapshots(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  worktree: GitSessionWorktree,
  persistDiscoverySnapshots: typeof persistDiscoverySnapshotsType
): Promise<FrozenDiscoverySnapshots> {
  const persisted = await persistDiscoverySnapshots(storageRoot, projectPath, sessionId, {
    reviewedSnapshotSourcePath: worktree.agentProjectPath,
    handoffSnapshotSourceDir: worktree.sourceSnapshotDir ?? "",
    sourceRepoFingerprint: worktree.sourceFingerprint ?? "",
  });

  return {
    reviewedSnapshotPath: persisted.reviewedSnapshotPath,
    reviewedSnapshotRef: worktree.retainedBranch,
    reviewedSnapshotFingerprint: persisted.reviewedSnapshotFingerprint,
    handoffSnapshotPath: persisted.handoffSnapshotPath,
    handoffSnapshotFingerprint: persisted.handoffSnapshotFingerprint,
    sourceRepoFingerprint: persisted.sourceRepoFingerprint,
  };
}
