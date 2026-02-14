import { describe, expect, test } from "bun:test";
import { AGENTS } from "@/lib/agents";
import {
  parseFixSummaryOutput,
  parseReviewSummaryOutput,
  type StructuredOutputSource,
} from "@/lib/structured-output";
import type { AgentType, FixSummary, ReviewSummary } from "@/lib/types";

type FixtureRole = "fixer" | "reviewer";

type FixtureExpectation =
  | {
      ok: true;
      source: StructuredOutputSource;
      usedRepair: boolean;
      value: unknown;
    }
  | {
      ok: false;
      source: null;
      usedRepair: boolean;
      failureReason: string;
    };

const FIXTURE_ROOT = "tests/fixtures/structured-output";

function listFixtureFiles(): string[] {
  const glob = new Bun.Glob("**/*.jsonl");
  const files: string[] = [];

  for (const file of glob.scanSync({ cwd: FIXTURE_ROOT })) {
    files.push(file);
  }

  return files.sort();
}

function parseFixturePath(path: string): { agent: AgentType; role: FixtureRole; caseName: string } {
  const [agentRaw, roleRaw, caseFile] = path.split("/");
  const caseName = (caseFile ?? "").replace(/\.jsonl$/, "");
  const role = roleRaw === "fixer" ? "fixer" : "reviewer";
  return { agent: agentRaw as AgentType, role, caseName };
}

describe("structured output parser contract fixtures", () => {
  const fixtureFiles = listFixtureFiles();

  test("fixture matrix is present", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const fixtureFile of fixtureFiles) {
    const { agent, role, caseName } = parseFixturePath(fixtureFile);

    test(`${agent}/${role}/${caseName}`, async () => {
      const rawOutput = await Bun.file(`${FIXTURE_ROOT}/${fixtureFile}`).text();
      const expectedPath = `${FIXTURE_ROOT}/${fixtureFile.replace(/\.jsonl$/, ".expected.json")}`;
      const expected = (await Bun.file(expectedPath).json()) as FixtureExpectation;

      const extracted = AGENTS[agent].extractResult(rawOutput);
      const parsed =
        role === "fixer"
          ? parseFixSummaryOutput(extracted, rawOutput)
          : parseReviewSummaryOutput(extracted, rawOutput);

      expect(parsed.ok).toBe(expected.ok);
      expect(parsed.usedRepair).toBe(expected.usedRepair);

      if (expected.ok) {
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.source).toBe(expected.source);
          expect(parsed.value).toEqual(expected.value as FixSummary | ReviewSummary);
          expect(parsed.failureReason).toBeNull();
        }
        return;
      }

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.source).toBeNull();
        expect(parsed.failureReason).toBe(expected.failureReason);
      }
    });
  }
});
