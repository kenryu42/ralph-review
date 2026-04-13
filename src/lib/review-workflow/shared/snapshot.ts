import type { persistReviewedSnapshot as persistReviewedSnapshotType } from "@/lib/review-workflow/findings/artifact";

export interface FrozenReviewedSnapshot {
  reviewedSnapshotPath: string;
  reviewedSnapshotRef: string;
  sourceFingerprint: string;
}

export async function freezeReviewedSnapshot(
  storageRoot: string,
  projectPath: string,
  sessionId: string,
  sourceSnapshotPath: string,
  reviewedSnapshotRef: string,
  persistReviewedSnapshot: typeof persistReviewedSnapshotType
): Promise<FrozenReviewedSnapshot> {
  const persisted = await persistReviewedSnapshot(
    storageRoot,
    projectPath,
    sessionId,
    sourceSnapshotPath
  );

  return {
    reviewedSnapshotPath: persisted.reviewedSnapshotPath,
    reviewedSnapshotRef,
    sourceFingerprint: persisted.sourceFingerprint,
  };
}
