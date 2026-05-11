import { describe, expect, test } from "bun:test";
import { runUpdate } from "@/commands/update";
import type { CommandDef, ParseResult } from "@/lib/cli-parser";
import { SelfUpdateError, type SelfUpdateOptions, type SelfUpdateResult } from "@/lib/self-update";
import { createSpinnerCapture } from "../helpers/capture";

interface UpdateHarness {
  overrides: NonNullable<Parameters<typeof runUpdate>[1]>;
  errors: string[];
  infos: string[];
  messages: string[];
  successes: string[];
  exits: number[];
  performCalls: SelfUpdateOptions[];
  spinnerStarts: string[];
  spinnerStops: string[];
}

function createUpdateHarness(
  result: SelfUpdateResult | Error = {
    status: "up-to-date",
    manager: "npm",
    currentVersion: "0.1.6",
    latestVersion: "0.1.6",
  },
  parseResult: ParseResult<{ check: boolean; manager?: string }> = {
    values: {
      check: false,
    },
    positional: [],
  }
): UpdateHarness {
  const errors: string[] = [];
  const infos: string[] = [];
  const messages: string[] = [];
  const successes: string[] = [];
  const exits: number[] = [];
  const performCalls: SelfUpdateOptions[] = [];
  const spinner = createSpinnerCapture();

  const updateDef: CommandDef = {
    name: "update",
    description: "Update ralph-review",
  };

  return {
    overrides: {
      getCommandDef: () => updateDef,
      parseCommand: <T = Record<string, unknown>>() => ({
        values: parseResult.values as T,
        positional: parseResult.positional,
      }),
      performSelfUpdate: async (options) => {
        performCalls.push(options);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
      spinner: spinner.spinner,
      log: {
        error: (message: string) => errors.push(message),
        info: (message: string) => infos.push(message),
        message: (message: string) => messages.push(message),
        success: (message: string) => successes.push(message),
      },
      exit: (code: number) => exits.push(code),
      cliPath: "/usr/local/lib/node_modules/ralph-review/src/cli.ts",
      getCurrentVersion: () => "0.1.6",
      which: (command: string) => `/usr/bin/${command}`,
      runText: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
      runInteractive: async () => 0,
    },
    errors,
    infos,
    messages,
    successes,
    exits,
    performCalls,
    spinnerStarts: spinner.starts,
    spinnerStops: spinner.stops,
  };
}

function createCheckUpdateHarness(manager: "brew" | "npm", latestVersion?: string) {
  return createUpdateHarness(
    {
      status: "update-available",
      manager,
      currentVersion: "0.1.6",
      latestVersion,
    },
    {
      values: {
        check: true,
        manager,
      },
      positional: [],
    }
  );
}

describe("update command", () => {
  test("reports an internal error when the command definition is missing", async () => {
    const harness = createUpdateHarness();
    harness.overrides.getCommandDef = () => undefined;

    await runUpdate([], harness.overrides);

    expect(harness.errors).toEqual(["Internal error: update command definition not found"]);
    expect(harness.exits).toEqual([1]);
  });

  test("rejects invalid --manager values before running self-update", async () => {
    const harness = createUpdateHarness(undefined, {
      values: {
        check: false,
        manager: "pip",
      },
      positional: [],
    });

    await runUpdate(["--manager", "pip"], harness.overrides);

    expect(harness.errors).toEqual(['Invalid value for --manager: "pip"']);
    expect(harness.messages).toEqual(["Valid values: npm, brew"]);
    expect(harness.performCalls).toEqual([]);
    expect(harness.exits).toEqual([1]);
  });

  test("prints a success message when already up to date", async () => {
    const harness = createUpdateHarness({
      status: "up-to-date",
      manager: "npm",
      currentVersion: "0.1.6",
      latestVersion: "0.1.6",
    });

    await runUpdate([], harness.overrides);

    expect(harness.successes).toEqual(["ralph-review is already up to date via npm (0.1.6)."]);
    expect(harness.exits).toEqual([]);
    expect(harness.spinnerStarts).toEqual(["Checking for updates..."]);
    expect(harness.spinnerStops).toEqual(["Done."]);
  });

  test("prints npm check-mode availability with both versions", async () => {
    const harness = createCheckUpdateHarness("npm", "0.1.7");

    await runUpdate(["--check", "--manager", "npm"], harness.overrides);

    expect(harness.infos).toEqual(["Update available via npm: 0.1.6 -> 0.1.7"]);
    expect(harness.spinnerStops).toEqual(["Done."]);
  });

  test("prints brew check-mode availability with both versions", async () => {
    const harness = createCheckUpdateHarness("brew", "0.1.7");

    await runUpdate(["--check", "--manager", "brew"], harness.overrides);

    expect(harness.infos).toEqual(["Update available via Homebrew: 0.1.6 -> 0.1.7"]);
    expect(harness.spinnerStops).toEqual(["Done."]);
  });

  test("prints update-available with only current version when latest is unknown", async () => {
    const harness = createCheckUpdateHarness("brew");

    await runUpdate(["--check", "--manager", "brew"], harness.overrides);

    expect(harness.infos).toEqual(["Update available via Homebrew. Current version: 0.1.6"]);
  });

  test("prints a success message after updating", async () => {
    const harness = createUpdateHarness();
    harness.overrides.performSelfUpdate = async (options) => {
      harness.performCalls.push(options);
      await options.onBeforeInstall?.({
        manager: "brew",
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
      });

      return {
        status: "updated",
        manager: "brew",
        previousVersion: "0.1.6",
        finalVersion: "0.1.7",
      };
    };

    await runUpdate([], harness.overrides);

    expect(harness.successes).toEqual(["Updated ralph-review via Homebrew: 0.1.6 -> 0.1.7"]);
    expect(harness.infos).toEqual(["Installing update via Homebrew..."]);
    expect(harness.spinnerStarts).toEqual(["Checking for updates..."]);
    expect(harness.spinnerStops).toEqual(["Update check complete."]);
  });

  test("renders self-update guidance on failure and exits", async () => {
    const harness = createUpdateHarness(
      new SelfUpdateError("Could not determine how ralph-review was installed.", [
        "Run: rr update --manager npm",
        "Run: rr update --manager brew",
      ])
    );

    await runUpdate([], harness.overrides);

    expect(harness.errors).toEqual(["Could not determine how ralph-review was installed."]);
    expect(harness.messages).toEqual([
      "Run: rr update --manager npm",
      "Run: rr update --manager brew",
    ]);
    expect(harness.exits).toEqual([1]);
    expect(harness.spinnerStarts).toEqual(["Checking for updates..."]);
    expect(harness.spinnerStops).toEqual(["Update failed."]);
  });

  test("does not stop the spinner twice when install fails after handoff", async () => {
    const harness = createUpdateHarness();
    harness.overrides.performSelfUpdate = async (options) => {
      harness.performCalls.push(options);
      await options.onBeforeInstall?.({
        manager: "npm",
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
      });

      throw new SelfUpdateError("npm install -g ralph-review@latest exited with code 2.");
    };

    await runUpdate([], harness.overrides);

    expect(harness.infos).toEqual(["Installing update via npm..."]);
    expect(harness.errors).toEqual(["npm install -g ralph-review@latest exited with code 2."]);
    expect(harness.exits).toEqual([1]);
    expect(harness.spinnerStarts).toEqual(["Checking for updates..."]);
    expect(harness.spinnerStops).toEqual(["Update check complete."]);
  });
});
