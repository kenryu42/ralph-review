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

function createExpectedFixture(role: FixtureRole, caseName: string): FixtureExpectation {
  if (caseName === "framed-unrepairable") {
    return {
      ok: false,
      source: null,
      usedRepair: true,
      failureReason: "no structured output candidate matched the required schema",
    };
  }

  if (role === "fixer") {
    return {
      ok: true,
      source: "framed-extracted",
      usedRepair: caseName === "framed-repairable-trailing-comma",
      value: {
        decision: "APPLY_SELECTIVELY",
        fixes: [
          {
            id: 1,
            title: "Guard null access",
            priority: "P1",
            file: "src/lib/engine.ts",
            claim: "Null access can throw",
            evidence: "src/lib/engine.ts:42",
            fix: "Added null guard before dereference",
          },
        ],
        skipped: [
          {
            id: 2,
            title: "Non-actionable style note",
            priority: "P3",
            reason: "SKIP: style-only concern",
          },
        ],
      },
    };
  }

  return {
    ok: true,
    source: "framed-extracted",
    usedRepair: caseName === "framed-repairable-trailing-comma",
    value: {
      findings: [
        {
          title: "Handle undefined config",
          body: "Config access can throw when the optional field is missing.",
          confidence_score: 0.88,
          priority: 1,
          code_location: {
            absolute_file_path: "/repo/src/lib/config.ts",
            line_range: {
              start: 10,
              end: 12,
            },
          },
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "One reliability issue was found.",
      overall_confidence_score: 0.88,
    },
  };
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
      const expected = createExpectedFixture(role, caseName);

      const extracted = await AGENTS[agent].extractResult(rawOutput);
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
