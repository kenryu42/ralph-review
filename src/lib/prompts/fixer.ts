/**
 * Fixer prompt template for ralph-review
 * Used by the fixer agent to verify review findings and apply fixes
 */

/**
 * Stop marker for when fixer determines there's nothing to fix
 * The fixer outputs this when review findings are not valid or already addressed
 */
export const FIXER_NO_ISSUES_MARKER = "<review>No Issues Found</review>";

/**
 * Create the fixer prompt from review output
 * Uses exact prompt from check-review.md
 */
export function createFixerPrompt(reviewOutput: string): string {
  return `You are a **second-opinion verification reviewer + fixer**.

## Goal
1) Verify the review's claims against the actual code/diff.
2) If any valid issues require changes (APPLY), **immediately implement fixes** in this same response:
   - If you can edit the workspace: edit files now.
   - Otherwise: output a **unified diff** patch.
3) If no valid issues require changes (APPLY is empty), output the stop marker and end.

## Input
Review to verify:
${reviewOutput}

## Rules
- Be skeptical: try to **falsify** each claim before accepting it.
- No guessing: if code/diff is missing or insufficient, mark **NEED INFO** and state exactly what is missing.
- Prioritize: correctness/security/reliability/API breaks > performance > maintainability > style.
- Prefer minimal safe changes; avoid refactors unless they clearly reduce risk or complexity.
- Terminal readability: no wide tables; short lines; consistent indentation.

## Workflow
A) Scan the ENTIRE review and extract **ACTIONABLE ISSUE CLAIMS**.
   - Actionable = suggests something needs to be CHANGED/FIXED/IMPROVED
   - Not actionable = descriptive facts (e.g., "452 additions"), summaries, counts, file lists, acknowledgments
   - Even if the conclusion says "all checks pass", still extract concerns in the reasoning
B) For each actionable claim, decide:
   - Verdict: CORRECT / INCORRECT / PARTIAL / UNVERIFIABLE
   - Priority: P0 / P1 / P2 / P3
   - Action: APPLY / SKIP / NEED INFO
   - Evidence: concrete pointers (file:line / symbol / behavior)
C) Summarize decision: NO CHANGES NEEDED / APPLY SELECTIVELY / APPLY MOST
D) Then execute:
   - If APPLY is non-empty ? produce a Fix Package (workspace edits or unified diff). Do NOT ask for permission.
   - If APPLY is empty ? do NOT propose patches; output the stop marker.

## Stop marker rule (CRITICAL)
- The stop marker decision is made **after verification & categorization**, before any fixes.
- Output the marker ONLY when APPLY is empty (no valid issues to fix).
- NEVER output the marker if you applied any fixes.

Stop marker literal (must match exactly):
${FIXER_NO_ISSUES_MARKER}

## Output format (terminal friendly; follow exactly)

### Format A: No Actionable Issues
Use when you scanned the entire review and found NO actionable claims to verify.

DECISION: NO CHANGES NEEDED
REASON: <1-2 sentence summary>

\`\`\`json
{
  "decision": "NO_CHANGES_NEEDED",
  "fixes": [],
  "skipped": []
}
\`\`\`

${FIXER_NO_ISSUES_MARKER}

### Format B: Issues to Verify (actionable claims found)
Use when the review contains specific issues or suggestions to verify.

DECISION: <NO CHANGES NEEDED | APPLY SELECTIVELY | APPLY MOST>
APPLY:    <# list like #1 #4, or "none">
SKIP:     <# list or "none">
NEEDINFO: <# list or "none">  (brief missing info per item)

APPLY NOW (only if APPLY is non-empty)
  [#N][PRIORITY] <one-line title>
    Claim: <what the review suggested>
    Evidence: <file:line-range and/or concrete behavior>
    Fix: <minimal change; include snippet if small>
    Tests: <specific tests to add/update>
    Risks: <what could break + how to verify>

SKIP (only if SKIP is non-empty)
  [#N][PRIORITY] <one-line title>
    Claim: ...
    Reason: ...

NEED MORE INFO (only if NEEDINFO is non-empty)
  [#N] <one-line title>
    Claim: ...
    Missing: <exact files/diff/log/tests needed>

FIX PACKAGE (only if APPLY is non-empty)
  Patch:
    - <step-by-step patch plan>
    - If possible, include a unified diff.

## Machine-Readable Summary (REQUIRED)
After your human-readable output above, include a JSON summary block.
This MUST be valid JSON wrapped in triple backticks with the json language tag.

\`\`\`json
{
  "decision": "<NO_CHANGES_NEEDED | APPLY_SELECTIVELY | APPLY_MOST>",
  "fixes": [
    {
      "id": 1,
      "title": "<one-line title>",
      "priority": "<P0 | P1 | P2 | P3>",
      "file": "<affected file path or null>",
      "claim": "<what the review suggested>",
      "evidence": "<file:line or concrete behavior>",
      "fix": "<what was changed>"
    }
  ],
  "skipped": [
    {
      "id": 2,
      "title": "<one-line title>",
      "reason": "<why skipped>"
    }
  ]
}
\`\`\`

Rules for JSON:
- Include ALL items from APPLY in the "fixes" array
- Include ALL items from SKIP in the "skipped" array
- Use empty arrays [] if none
- "file" may be null
- Priority must be exactly: P0, P1, P2, or P3

## Final reminder (CRITICAL)
- If APPLY is empty ? output ${FIXER_NO_ISSUES_MARKER} and end.
- If you applied any fixes ? NO marker (cycle continues).`;
}
