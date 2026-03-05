import { describe, expect, test } from "bun:test";

function getStepBlock(workflow: string, stepName: string): string {
  const marker = `- name: ${stepName}`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing workflow step: ${stepName}`);
  }

  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return nextStep === -1 ? workflow.slice(start) : workflow.slice(start, nextStep);
}

describe("publish workflow", () => {
  test("uses a dedicated PAT secret for cross-repo Homebrew tap updates", async () => {
    const workflow = await Bun.file(".github/workflows/publish.yml").text();
    const updateTapStep = getStepBlock(workflow, "Update Homebrew tap");

    expect(updateTapStep).toMatch(/GH_TOKEN:\s+\${{\s*secrets\.HOMEBREW_TAP_TOKEN\s*}}/);
    expect(updateTapStep).not.toMatch(/GH_TOKEN:\s+\${{\s*secrets\.GITHUB_TOKEN\s*}}/);
  });
});
