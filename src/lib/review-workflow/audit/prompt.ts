import {
  createReviewerStructuredOutputInstructions,
  REVIEW_SUMMARY_END_TOKEN,
  REVIEW_SUMMARY_START_TOKEN,
} from "@/lib/prompts/protocol";
import type { StoredFinding } from "@/lib/review-workflow/findings/types";

function formatSelectedFindings(findings: StoredFinding[]): string {
  return findings
    .map((finding) => {
      return [
        `- ${finding.id} [${finding.priority}] ${finding.filePath}:${finding.startLine}-${finding.endLine}`,
        `  Title: ${finding.title}`,
        `  Body: ${finding.body}`,
      ].join("\n");
    })
    .join("\n");
}

export interface TargetedAuditPromptOptions {
  reviewedSnapshotPath: string;
  mutableWorkspacePath: string;
  selectedFindings: StoredFinding[];
  changedFileHints: string[];
}

export function createTargetedAuditPrompt(options: TargetedAuditPromptOptions): string {
  const changedFileHints =
    options.changedFileHints.length > 0
      ? options.changedFileHints.map((entry) => `- ${entry}`).join("\n")
      : "- No changed file hints were captured.";

  return `You are running a targeted final audit after a batch fixer pass.

## Scope
- Audit only the selected findings listed below.
- Audit only the changed files and touched hunks listed below.
- Do not reopen broad discovery.
- Do not search for unrelated issues outside the selected findings and changed scope.

## Snapshot boundary
- Original reviewed snapshot: \`${options.reviewedSnapshotPath}\`
- Mutable fixed workspace: \`${options.mutableWorkspacePath}\`

## Selected findings to verify
${formatSelectedFindings(options.selectedFindings)}

## Changed files or hunk hints
${changedFileHints}

## Required output
Return only:
- \`resolvedFindingIds\`
- \`unresolvedFindingIds\`
- \`regressionFindings\`

Each regression finding must describe a new issue introduced by the fixer within the changed scope.

## JSON (REQUIRED)
${createReviewerStructuredOutputInstructions()}

${REVIEW_SUMMARY_START_TOKEN}
{
  "resolvedFindingIds": ["F001"],
  "unresolvedFindingIds": ["F002"],
  "regressionFindings": [
    {
      "title": "<one-line title>",
      "body": "<why the regression is real>",
      "confidence_score": <0-1 number>,
      "priority": <0 | 1 | 2 | 3>,
      "code_location": {
        "absolute_file_path": "<absolute path>",
        "line_range": { "start": <int>, "end": <int> }
      }
    }
  ]
}
${REVIEW_SUMMARY_END_TOKEN}

JSON rules:
- Every selected finding ID must appear in exactly one of \`resolvedFindingIds\` or \`unresolvedFindingIds\`.
- Do not mention finding IDs that were not selected.
- Keep \`regressionFindings\` empty when no new issues were introduced.
- The delimited JSON block must be the final output.`;
}
