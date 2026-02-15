import { describe, expect, test } from "bun:test";
import { type RrrDeps, runRrr, runRrrEntrypoint } from "@/cli-rrr";

interface RrrHarness {
  deps: Partial<RrrDeps>;
  logs: string[];
  errors: string[];
  exits: number[];
  reviewCalls: string[][];
}

function createRrrHarness(overrides: Partial<RrrDeps> = {}): RrrHarness {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const reviewCalls: string[][] = [];

  const deps: Partial<RrrDeps> = {
    printCommandHelp: () => undefined,
    startReview: async (args) => {
      reviewCalls.push([...args]);
    },
    log: (message) => {
      logs.push(message);
    },
    error: (message) => {
      errors.push(message);
    },
    exit: (code) => {
      exits.push(code);
    },
    ...overrides,
  };

  return { deps, logs, errors, exits, reviewCalls };
}

describe("cli-rrr", () => {
  test("prints alias help and run options when --help is passed", async () => {
    const harness = createRrrHarness({
      printCommandHelp: () =>
        "Run command\n\nOPTIONS:\n  --max <n>\n  --force\nEXAMPLES:\n  rr run",
    });

    await runRrr(["--help"], harness.deps);

    expect(harness.logs).toEqual([
      "rrr - Quick alias for 'rr run'\n",
      "USAGE:",
      "  rrr [options]\n",
      "All options are passed through to 'rr run'.\n",
      "OPTIONS:\n  --max <n>\n  --force",
    ]);
    expect(harness.reviewCalls).toEqual([]);
  });

  test("prints alias help without options block when run help has no options", async () => {
    const harness = createRrrHarness({
      printCommandHelp: () => "Run command help without options",
    });

    await runRrr(["-h"], harness.deps);

    expect(harness.logs).toEqual([
      "rrr - Quick alias for 'rr run'\n",
      "USAGE:",
      "  rrr [options]\n",
      "All options are passed through to 'rr run'.\n",
    ]);
    expect(harness.reviewCalls).toEqual([]);
  });

  test("passes all args through to startReview", async () => {
    const harness = createRrrHarness();

    await runRrr(["--max", "3", "--force"], harness.deps);

    expect(harness.reviewCalls).toEqual([["--max", "3", "--force"]]);
    expect(harness.logs).toEqual([]);
  });

  test("runRrrEntrypoint reports rejected promises and exits", async () => {
    const harness = createRrrHarness();

    runRrrEntrypoint(() => Promise.reject(new Error("boom")), {
      error: (message) => {
        harness.errors.push(message);
      },
      exit: (code) => {
        harness.exits.push(code);
      },
    });

    await Bun.sleep(0);

    expect(harness.errors).toEqual(["Error: Error: boom"]);
    expect(harness.exits).toEqual([1]);
  });
});
