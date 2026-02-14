export const REVIEW_SUMMARY_START_TOKEN = "<<<RR_REVIEW_SUMMARY_JSON_START>>>";
export const REVIEW_SUMMARY_END_TOKEN = "<<<RR_REVIEW_SUMMARY_JSON_END>>>";
export const FIX_SUMMARY_START_TOKEN = "<<<RR_FIX_SUMMARY_JSON_START>>>";
export const FIX_SUMMARY_END_TOKEN = "<<<RR_FIX_SUMMARY_JSON_END>>>";

export function createReviewerStructuredOutputInstructions(): string {
  return `
## Structured output protocol (STRICT)
- Output MUST be one JSON object that matches the required schema.
- Wrap that JSON object using these exact delimiters:
  - ${REVIEW_SUMMARY_START_TOKEN}
  - ${REVIEW_SUMMARY_END_TOKEN}
- Do not include markdown fences.
- Do not include any text before the start token or after the end token.`;
}

export function createFixerStructuredOutputInstructions(): string {
  return `
## Structured output protocol (STRICT)
- Output MUST be one JSON object that matches the required schema.
- Wrap that JSON object using these exact delimiters:
  - ${FIX_SUMMARY_START_TOKEN}
  - ${FIX_SUMMARY_END_TOKEN}
- Do not wrap the JSON in markdown fences.
- The delimited JSON block MUST be the final output in the response.`;
}

export function createReviewerSummaryRetryReminder(): string {
  return `
IMPORTANT: Your previous response was missing or invalid structured JSON output.
Return ONLY one schema-valid JSON object wrapped in:
${REVIEW_SUMMARY_START_TOKEN}
<json>
${REVIEW_SUMMARY_END_TOKEN}`;
}

export function createFixerSummaryRetryReminder(): string {
  return `
IMPORTANT: Your previous response was missing or invalid structured JSON output.
Do not make additional file edits in this retry.
Return ONLY one schema-valid JSON object wrapped in:
${FIX_SUMMARY_START_TOKEN}
<json>
${FIX_SUMMARY_END_TOKEN}`;
}
