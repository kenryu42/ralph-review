import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type CommandResult,
  detectUpdateManager,
  getDefaultSelfUpdateDependencies,
  performSelfUpdate,
  type SelfUpdateDependencies,
  SelfUpdateError,
} from "@/lib/self-update";

type RunnerMap = Record<string, CommandResult>;
const originalSpawn = Bun.spawn;
const NPM_LIST_COMMAND = "npm list -g ralph-review --json --depth=0";
const NPM_VIEW_COMMAND = "npm view ralph-review version";

function npmListResult(version: string): CommandResult {
  return {
    stdout: JSON.stringify({
      dependencies: {
        "ralph-review": {
          version,
        },
      },
    }),
    stderr: "",
    exitCode: 0,
  };
}

function createDependencies(
  overrides: Partial<SelfUpdateDependencies> = {},
  commandResults: RunnerMap = {}
): {
  deps: SelfUpdateDependencies;
  textCalls: string[][];
  interactiveCalls: string[][];
} {
  const textCalls: string[][] = [];
  const interactiveCalls: string[][] = [];
  const {
    runInteractive: overrideRunInteractive,
    runText: overrideRunText,
    ...otherOverrides
  } = overrides;

  return {
    deps: {
      cliPath: "/usr/local/lib/node_modules/ralph-review/src/cli.ts",
      getCurrentVersion: () => "0.1.6",
      which: (command: string) => `/usr/bin/${command}`,
      runText: async (command: string[]) => {
        textCalls.push(command);
        if (overrideRunText) {
          return overrideRunText(command);
        }

        const key = command.join(" ");
        return (
          commandResults[key] ?? {
            stdout: "",
            stderr: "",
            exitCode: 0,
          }
        );
      },
      runInteractive: async (command: string[]) => {
        interactiveCalls.push(command);
        if (overrideRunInteractive) {
          return overrideRunInteractive(command);
        }

        return 0;
      },
      ...otherOverrides,
    },
    textCalls,
    interactiveCalls,
  };
}

afterEach(() => {
  Bun.spawn = originalSpawn;
});

describe("self-update", () => {
  describe("getDefaultSelfUpdateDependencies", () => {
    test("reads the installed package version from package.json next to the CLI", async () => {
      const tempDir = await mkdtemp("/tmp/rr-self-update-");
      const packageRoot = join(tempDir, "ralph-review");
      const srcDir = join(packageRoot, "src");
      const cliPath = join(srcDir, "cli.ts");

      try {
        await mkdir(srcDir, { recursive: true });
        await Bun.write(join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
        await Bun.write(cliPath, "#!/usr/bin/env bun\n");

        const deps = getDefaultSelfUpdateDependencies(cliPath);
        await expect(deps.getCurrentVersion()).resolves.toBe("1.2.3");
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    });

    test("throws when the adjacent package.json does not contain a version", async () => {
      const tempDir = await mkdtemp("/tmp/rr-self-update-");
      const packageRoot = join(tempDir, "ralph-review");
      const srcDir = join(packageRoot, "src");
      const cliPath = join(srcDir, "cli.ts");

      try {
        await mkdir(srcDir, { recursive: true });
        await Bun.write(join(packageRoot, "package.json"), JSON.stringify({}));
        await Bun.write(cliPath, "#!/usr/bin/env bun\n");

        const deps = getDefaultSelfUpdateDependencies(cliPath);
        await expect(deps.getCurrentVersion()).rejects.toThrow(
          `Could not determine version from ${join(packageRoot, "package.json")}`
        );
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    });

    test("captures stdout and stderr for text commands", async () => {
      Bun.spawn = (() => ({
        stdout: new Response("stdout").body,
        stderr: new Response("stderr").body,
        exited: Promise.resolve(7),
      })) as unknown as typeof Bun.spawn;

      const deps = getDefaultSelfUpdateDependencies("/tmp/ralph-review/src/cli.ts");
      await expect(deps.runText(["fake", "command"])).resolves.toEqual({
        stdout: "stdout",
        stderr: "stderr",
        exitCode: 7,
      });
    });

    test("returns empty strings when a text command has no piped streams", async () => {
      Bun.spawn = (() => ({
        stdout: null,
        stderr: null,
        exited: Promise.resolve(0),
      })) as unknown as typeof Bun.spawn;

      const deps = getDefaultSelfUpdateDependencies("/tmp/ralph-review/src/cli.ts");
      await expect(deps.runText(["fake", "command"])).resolves.toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });

    test("runs interactive commands with inherited stdio", async () => {
      const calls: Array<{
        command: string[];
        options: { stdin?: string; stdout?: string; stderr?: string };
      }> = [];

      Bun.spawn = ((
        command: string[],
        options?: { stdin?: string; stdout?: string; stderr?: string }
      ) => {
        calls.push({
          command: [...command],
          options: {
            stdin: String(options?.stdin),
            stdout: String(options?.stdout),
            stderr: String(options?.stderr),
          },
        });

        return {
          exited: Promise.resolve(0),
        };
      }) as unknown as typeof Bun.spawn;

      const deps = getDefaultSelfUpdateDependencies("/tmp/ralph-review/src/cli.ts");
      await expect(deps.runInteractive(["brew", "upgrade", "ralph-review"])).resolves.toBe(0);
      expect(calls).toEqual([
        {
          command: ["brew", "upgrade", "ralph-review"],
          options: {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          },
        },
      ]);
    });
  });

  describe("detectUpdateManager", () => {
    test("detects npm from the active CLI path", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/usr/local/lib/node_modules/ralph-review/src/cli.ts",
          which: (command: string) => (command === "npm" ? "/usr/bin/npm" : null),
        },
        {
          "npm prefix -g": {
            stdout: "/usr/local\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(detectUpdateManager(deps)).resolves.toBe("npm");
    });

    test("detects brew from the active CLI path", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/opt/homebrew/Cellar/ralph-review/0.1.6/libexec/src/cli.ts",
          which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
        },
        {
          "brew --prefix --installed ralph-review": {
            stdout: "/opt/homebrew/opt/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(detectUpdateManager(deps)).resolves.toBe("brew");
    });

    test("detects brew from the Homebrew bin symlink path", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/opt/homebrew/bin/rr",
          which: (command: string) => (command === "brew" ? "/opt/homebrew/bin/brew" : null),
        },
        {
          "brew --prefix --installed ralph-review": {
            stdout: "/opt/homebrew/opt/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(detectUpdateManager(deps)).resolves.toBe("brew");
    });

    test("prefers brew when Homebrew and npm share a prefix bin directory", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/opt/homebrew/bin/rr",
        },
        {
          "npm prefix -g": {
            stdout: "/opt/homebrew\n",
            stderr: "",
            exitCode: 0,
          },
          "brew --prefix --installed ralph-review": {
            stdout: "/opt/homebrew/opt/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(detectUpdateManager(deps)).resolves.toBe("brew");
    });

    test("rejects ambiguous manager detection", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/usr/local/lib/node_modules/ralph-review/src/cli.ts",
        },
        {
          "npm prefix -g": {
            stdout: "/usr/local\n",
            stderr: "",
            exitCode: 0,
          },
          "brew --prefix --installed ralph-review": {
            stdout: "/usr/local/lib/node_modules/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(detectUpdateManager(deps)).rejects.toThrow(SelfUpdateError);
      await expect(detectUpdateManager(deps)).rejects.toThrow("Could not determine");
    });

    test("rejects source-checkout execution with guidance", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/Users/dev/ralph-review/src/cli.ts",
        },
        {
          "npm prefix -g": {
            stdout: "/usr/local\n",
            stderr: "",
            exitCode: 0,
          },
          "brew --prefix --installed ralph-review": {
            stdout: "/opt/homebrew/opt/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
          "git -C /Users/dev/ralph-review rev-parse --is-inside-work-tree": {
            stdout: "true\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      try {
        await detectUpdateManager(deps);
        throw new Error("expected detectUpdateManager to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toBe("Self-update is not available when running from source.");
        expect(updateError.notes).toEqual([
          "Update with git pull, or install globally to enable self-update.",
        ]);
      }
    });

    test("rejects unrecognized installation with generic guidance", async () => {
      const { deps } = createDependencies(
        {
          cliPath: "/opt/custom/ralph-review/src/cli.ts",
        },
        {
          "npm prefix -g": {
            stdout: "/usr/local\n",
            stderr: "",
            exitCode: 0,
          },
          "brew --prefix --installed ralph-review": {
            stdout: "/opt/homebrew/opt/ralph-review\n",
            stderr: "",
            exitCode: 0,
          },
          "git -C /opt/custom/ralph-review rev-parse --is-inside-work-tree": {
            stdout: "",
            stderr: "fatal: not a git repository",
            exitCode: 128,
          },
        }
      );

      try {
        await detectUpdateManager(deps);
        throw new Error("expected detectUpdateManager to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toBe("Could not determine how ralph-review was installed.");
        expect(updateError.notes).toContain("Run: rr update --manager npm");
        expect(updateError.notes).toContain("Run: rr update --manager brew");
      }
    });

    test("rejects unrecognized installation with generic guidance when git is unavailable", async () => {
      const { deps } = createDependencies({
        cliPath: "/opt/custom/ralph-review/src/cli.ts",
        which: (command: string) => {
          if (command === "git") {
            return null;
          }

          return `/usr/bin/${command}`;
        },
        runText: async (command: string[]) => {
          const key = command.join(" ");
          if (key === "npm prefix -g") {
            return {
              stdout: "/usr/local\n",
              stderr: "",
              exitCode: 0,
            };
          }

          if (key === "brew --prefix --installed ralph-review") {
            return {
              stdout: "/opt/homebrew/opt/ralph-review\n",
              stderr: "",
              exitCode: 0,
            };
          }

          if (key === "git -C /opt/custom/ralph-review rev-parse --is-inside-work-tree") {
            throw new Error('Executable not found in $PATH: "git"');
          }

          throw new Error(`unexpected command: ${key}`);
        },
      });

      try {
        await detectUpdateManager(deps);
        throw new Error("expected detectUpdateManager to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toBe("Could not determine how ralph-review was installed.");
        expect(updateError.notes).toContain("Run: rr update --manager npm");
        expect(updateError.notes).toContain("Run: rr update --manager brew");
      }
    });
  });

  describe("performSelfUpdate", () => {
    test("bypasses auto-detection when manager override is provided", async () => {
      const { deps, textCalls } = createDependencies(
        {
          cliPath: "/Users/kenryu/Developer/420024-lab/ralph-review/src/cli.ts",
        },
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.6"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.6\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "npm",
        currentVersion: "0.1.6",
        latestVersion: "0.1.6",
      });
      expect(textCalls).toEqual([
        ["npm", "list", "-g", "ralph-review", "--json", "--depth=0"],
        ["npm", "view", "ralph-review", "version"],
      ]);
    });

    test("reports current npm version when already up to date", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.6"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.6\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "npm",
        currentVersion: "0.1.6",
        latestVersion: "0.1.6",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("reports a newer npm version when available", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.6"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.7\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "update-available",
        manager: "npm",
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("treats newer npm-installed versions as up to date during checks", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.8-canary.1"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.7\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "npm",
        currentVersion: "0.1.8-canary.1",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("reads the npm-managed installed version when manager override is used from a checkout", async () => {
      const tempDir = await mkdtemp("/tmp/rr-self-update-");
      const checkoutRoot = join(tempDir, "checkout");
      const checkoutSrcDir = join(checkoutRoot, "src");

      try {
        await mkdir(checkoutSrcDir, { recursive: true });
        await Bun.write(join(checkoutRoot, "package.json"), JSON.stringify({ version: "9.9.9" }));
        await Bun.write(join(checkoutSrcDir, "cli.ts"), "#!/usr/bin/env bun\n");

        const deps = getDefaultSelfUpdateDependencies(join(checkoutSrcDir, "cli.ts"));
        deps.which = (command: string) => (command === "npm" ? "/usr/bin/npm" : null);
        deps.runText = async (command: string[]) => {
          const key = command.join(" ");
          if (key === NPM_LIST_COMMAND) {
            return npmListResult("0.1.6");
          }

          if (key === NPM_VIEW_COMMAND) {
            return {
              stdout: "0.1.7\n",
              stderr: "",
              exitCode: 0,
            };
          }

          return {
            stdout: "",
            stderr: `unexpected command: ${key}`,
            exitCode: 1,
          };
        };

        const result = await performSelfUpdate({ checkOnly: true, manager: "npm" }, deps);

        expect(result).toEqual({
          status: "update-available",
          manager: "npm",
          currentVersion: "0.1.6",
          latestVersion: "0.1.7",
        });
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    });

    test("runs npm install -g when an npm update is available", async () => {
      let versionCallCount = 0;
      const { deps, interactiveCalls } = createDependencies();
      deps.runText = async (command: string[]) => {
        const key = command.join(" ");
        if (key === NPM_VIEW_COMMAND) {
          return {
            stdout: "0.1.7\n",
            stderr: "",
            exitCode: 0,
          };
        }

        if (key === NPM_LIST_COMMAND) {
          versionCallCount += 1;
          return npmListResult(versionCallCount === 1 ? "0.1.6" : "0.1.7");
        }

        return {
          stdout: "",
          stderr: `unexpected command: ${key}`,
          exitCode: 1,
        };
      };

      const result = await performSelfUpdate({ checkOnly: false, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "updated",
        manager: "npm",
        previousVersion: "0.1.6",
        finalVersion: "0.1.7",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([["npm", "install", "-g", "ralph-review@latest"]]);
    });

    test("does not downgrade newer npm-installed versions during updates", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.8-canary.1"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.7\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: false, manager: "npm" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "npm",
        currentVersion: "0.1.8-canary.1",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("returns actionable guidance when npm is unavailable", async () => {
      const { deps } = createDependencies({
        which: (command: string) => (command === "npm" ? null : `/usr/bin/${command}`),
      });

      try {
        await performSelfUpdate({ checkOnly: false, manager: "npm" }, deps);
        throw new Error("expected performSelfUpdate to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toContain("npm is not installed");
        expect(updateError.notes).toContain("Run: npm install -g ralph-review@latest");
      }
    });

    test("reports npm upgrade failures with the exit code", async () => {
      const { deps } = createDependencies(
        {
          runInteractive: async () => 2,
        },
        {
          [NPM_LIST_COMMAND]: npmListResult("0.1.6"),
          [NPM_VIEW_COMMAND]: {
            stdout: "0.1.7\n",
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(performSelfUpdate({ checkOnly: false, manager: "npm" }, deps)).rejects.toThrow(
        "npm install -g ralph-review@latest exited with code 2"
      );
    });

    test("reports current brew version when no brew update is available", async () => {
      const { deps, interactiveCalls, textCalls } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.6" }],
                versions: { stable: "0.1.6" },
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "brew",
        currentVersion: "0.1.6",
        latestVersion: "0.1.6",
      });
      expect(interactiveCalls).toEqual([]);
      expect(textCalls).toEqual([
        ["brew", "update", "--quiet"],
        ["brew", "info", "--json=v1", "ralph-review"],
      ]);
    });

    test("reports a newer brew version when available", async () => {
      const { deps, interactiveCalls, textCalls } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.6" }],
                versions: { stable: "0.1.7" },
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "update-available",
        manager: "brew",
        currentVersion: "0.1.6",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([]);
      expect(textCalls).toEqual([
        ["brew", "update", "--quiet"],
        ["brew", "info", "--json=v1", "ralph-review"],
      ]);
    });

    test("prefers the linked Homebrew keg version when multiple kegs are installed", async () => {
      const { deps } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                linked_keg: "0.1.7",
                installed: [{ version: "0.1.6" }, { version: "0.1.7" }],
                versions: { stable: "0.1.7" },
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "brew",
        currentVersion: "0.1.7",
        latestVersion: "0.1.7",
      });
    });

    test("treats newer brew-installed versions as up to date during checks", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.8" }],
                versions: { stable: "0.1.7" },
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: false, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "brew",
        currentVersion: "0.1.8",
        latestVersion: "0.1.7",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("treats matching Homebrew revisioned versions as up to date", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.6_1" }],
                versions: { stable: "0.1.6" },
                revision: 1,
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "up-to-date",
        manager: "brew",
        currentVersion: "0.1.6_1",
        latestVersion: "0.1.6_1",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("detects revision-only Homebrew updates", async () => {
      const { deps, interactiveCalls } = createDependencies(
        {},
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.6_1" }],
                versions: { stable: "0.1.6" },
                revision: 2,
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      const result = await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "update-available",
        manager: "brew",
        currentVersion: "0.1.6_1",
        latestVersion: "0.1.6_2",
      });
      expect(interactiveCalls).toEqual([]);
    });

    test("runs brew install with tap-qualified name when an update is available", async () => {
      let infoCallCount = 0;
      const { deps, interactiveCalls, textCalls } = createDependencies({
        runText: async (command: string[]) => {
          const key = command.join(" ");
          if (key === "brew update --quiet") {
            return {
              stdout: "",
              stderr: "",
              exitCode: 0,
            };
          }

          if (key === "brew info --json=v1 ralph-review") {
            infoCallCount += 1;
            return {
              stdout: JSON.stringify([
                {
                  installed: [{ version: infoCallCount === 1 ? "0.1.6" : "0.1.7" }],
                  versions: { stable: "0.1.7" },
                },
              ]),
              stderr: "",
              exitCode: 0,
            };
          }

          return {
            stdout: "",
            stderr: `unexpected command: ${key}`,
            exitCode: 1,
          };
        },
      });

      const result = await performSelfUpdate({ checkOnly: false, manager: "brew" }, deps);

      expect(result).toEqual({
        status: "updated",
        manager: "brew",
        previousVersion: "0.1.6",
        finalVersion: "0.1.7",
        latestVersion: "0.1.7",
      });
      expect(textCalls).toEqual([
        ["brew", "update", "--quiet"],
        ["brew", "info", "--json=v1", "ralph-review"],
        ["brew", "info", "--json=v1", "ralph-review"],
      ]);
      expect(interactiveCalls).toEqual([["brew", "install", "kenryu42/tap/ralph-review"]]);
    });

    test("fails with Homebrew update guidance when refreshing metadata fails", async () => {
      const { deps } = createDependencies(
        {},
        {
          "brew update --quiet": {
            stdout: "",
            stderr: "fatal: could not read from remote repository",
            exitCode: 1,
          },
        }
      );

      try {
        await performSelfUpdate({ checkOnly: true, manager: "brew" }, deps);
        throw new Error("expected performSelfUpdate to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toBe("Failed to refresh Homebrew metadata for ralph-review.");
        expect(updateError.notes).toEqual(["fatal: could not read from remote repository"]);
      }
    });

    test("returns actionable guidance when brew is unavailable", async () => {
      const { deps } = createDependencies({
        which: (command: string) => (command === "brew" ? null : `/usr/bin/${command}`),
      });

      try {
        await performSelfUpdate({ checkOnly: false, manager: "brew" }, deps);
        throw new Error("expected performSelfUpdate to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SelfUpdateError);
        const updateError = error as SelfUpdateError;
        expect(updateError.message).toContain("Homebrew is not installed");
        expect(updateError.notes).toContain("Run: brew install kenryu42/tap/ralph-review");
      }
    });

    test("reports brew install failures with the exit code", async () => {
      const { deps } = createDependencies(
        {
          runInteractive: async () => 3,
        },
        {
          "brew info --json=v1 ralph-review": {
            stdout: JSON.stringify([
              {
                installed: [{ version: "0.1.6" }],
                versions: { stable: "0.1.7" },
              },
            ]),
            stderr: "",
            exitCode: 0,
          },
        }
      );

      await expect(performSelfUpdate({ checkOnly: false, manager: "brew" }, deps)).rejects.toThrow(
        "brew install kenryu42/tap/ralph-review exited with code 3"
      );
    });
  });
});
