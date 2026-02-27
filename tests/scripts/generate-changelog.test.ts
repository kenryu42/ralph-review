import { describe, expect, test } from "bun:test";
import type { CommandRunner } from "../../scripts/generate-changelog";
import {
  formatReleaseNotes,
  generateChangelog,
  getContributors,
  getContributorsForRepo,
  getLatestReleasedTag,
  isIncludedCommit,
  REPO,
  runChangelog,
} from "../../scripts/generate-changelog";

type RunnerResponse = string | Error;

function createMockRunner(responses: readonly [string, RunnerResponse][]): CommandRunner {
  return (strings: TemplateStringsArray, ...values: readonly string[]) => {
    const command = strings.reduce((accumulator, part, index) => {
      const value = values[index] ?? "";
      return `${accumulator}${part}${value}`;
    }, "");

    return {
      text: async () => {
        const match = responses.find(([pattern]) => command.includes(pattern));
        if (!match) {
          throw new Error(`Unexpected command: ${command}`);
        }

        const response = match[1];
        if (response instanceof Error) {
          throw response;
        }

        return response;
      },
    };
  };
}

describe("generate-changelog script", () => {
  test("generates a flat changelog list and filters non feat/fix commits", async () => {
    const runner = createMockRunner([
      [
        'git log v1.2.3..HEAD --oneline --format="%h %s"',
        [
          "a1b2c3d feat: add changelog generation",
          "b2c3d4e chore: update docs",
          "c3d4e5f fix(parser): handle scoped type",
        ].join("\n"),
      ],
    ]);

    const changelog = await generateChangelog("v1.2.3", runner);

    expect(changelog).toEqual([
      "- a1b2c3d feat: add changelog generation",
      "- c3d4e5f fix(parser): handle scoped type",
    ]);
  });

  test("falls back to full log when tag-based git log fails", async () => {
    const runner = createMockRunner([
      ['git log v1.2.3..HEAD --oneline --format="%h %s"', new Error()],
      [
        'git log HEAD --oneline --format="%h %s"',
        ["a1b2c3d feat: add feature", "b2c3d4e chore: update docs"].join("\n"),
      ],
    ]);

    const changelog = await generateChangelog("v1.2.3", runner);

    expect(changelog).toEqual(["- a1b2c3d feat: add feature"]);
  });

  test("returns empty list when both git log commands fail", async () => {
    const runner = createMockRunner([
      ['git log v1.2.3..HEAD --oneline --format="%h %s"', new Error()],
      ['git log HEAD --oneline --format="%h %s"', new Error()],
    ]);

    const changelog = await generateChangelog("v1.2.3", runner);

    expect(changelog).toEqual([]);
  });

  test("formats notes without classification section headers", () => {
    const notes = formatReleaseNotes(
      ["- a1b2c3d feat: add changelog generation"],
      ["", "**Thank you to 1 community contributor:**", "- @alice:", "  - feat: add parser"]
    );

    expect(notes).toEqual([
      "- a1b2c3d feat: add changelog generation",
      "",
      "**Thank you to 1 community contributor:**",
      "- @alice:",
      "  - feat: add parser",
    ]);
    expect(notes.some((line) => line.startsWith("## "))).toBe(false);
  });

  test("formats empty changelog with fallback message", () => {
    const notes = formatReleaseNotes([], []);
    expect(notes).toEqual(["No changes in this release"]);
  });

  test("builds contributor block and keeps feat/fix filtering", async () => {
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: improve output\n\nbody" }),
      JSON.stringify({ login: "alice", message: "chore: update lockfile\n\nbody" }),
      JSON.stringify({ login: "actions-user", message: "fix: bot commit\n\nbody" }),
      JSON.stringify({ login: "bob", message: "fix(cli): handle empty notes\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      [
        "gh api \"/repos/example/repo/compare/v1.2.3...HEAD\" --jq '.commits[] | {login: .author.login, message: .commit.message}'",
        compareOutput,
      ],
    ]);

    const contributors = await getContributorsForRepo("v1.2.3", "example/repo", runner);

    expect(contributors).toEqual([
      "",
      "**Thank you to 2 community contributors:**",
      "- @alice:",
      "  - feat: improve output",
      "- @bob:",
      "  - fix(cli): handle empty notes",
    ]);
  });

  test("matches included commits with optional hash prefix and scope", () => {
    expect(isIncludedCommit("feat: add feature")).toBe(true);
    expect(isIncludedCommit("abc1234 fix(parser): handle scope")).toBe(true);
    expect(isIncludedCommit("chore: update docs")).toBe(false);
  });

  test("returns latest released tag when gh returns a value", async () => {
    const runner = createMockRunner([["gh release list", "v1.2.3\n"]]);
    await expect(getLatestReleasedTag(runner)).resolves.toBe("v1.2.3");
  });

  test("returns null when latest released tag command fails", async () => {
    const runner = createMockRunner([["gh release list", new Error("gh unavailable")]]);
    await expect(getLatestReleasedTag(runner)).resolves.toBeNull();
  });

  test("getContributors uses default repo constant", async () => {
    const compareOutput = JSON.stringify({
      login: "alice",
      message: "feat: improve output",
    });
    const runner = createMockRunner([
      [`gh api "/repos/${REPO}/compare/v1.2.3...HEAD"`, compareOutput],
    ]);

    const contributors = await getContributors("v1.2.3", runner);

    expect(contributors).toEqual([
      "",
      "**Thank you to 1 community contributor:**",
      "- @alice:",
      "  - feat: improve output",
    ]);
  });

  test("runChangelog logs initial release when no previous tag exists", async () => {
    const messages: string[] = [];
    const runner = createMockRunner([["gh release list", ""]]);

    await runChangelog({
      runner,
      log: (message) => {
        messages.push(message);
      },
    });

    expect(messages).toEqual(["Initial release"]);
  });

  test("runChangelog logs changelog entries and contributors", async () => {
    const messages: string[] = [];
    const compareOutput = [
      JSON.stringify({ login: "alice", message: "feat: improve output\n\nbody" }),
      JSON.stringify({ login: "bob", message: "fix(cli): handle empty notes\n\nbody" }),
    ].join("\n");
    const runner = createMockRunner([
      ["gh release list", "v1.2.3\n"],
      [
        'git log v1.2.3..HEAD --oneline --format="%h %s"',
        [
          "a1b2c3d feat: add changelog generation",
          "b2c3d4e chore: update docs",
          "c3d4e5f fix(parser): handle scoped type",
        ].join("\n"),
      ],
      [
        `gh api "/repos/${REPO}/compare/v1.2.3...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`,
        compareOutput,
      ],
    ]);

    await runChangelog({
      runner,
      log: (message) => {
        messages.push(message);
      },
    });

    expect(messages).toEqual([
      [
        "- a1b2c3d feat: add changelog generation",
        "- c3d4e5f fix(parser): handle scoped type",
        "",
        "**Thank you to 2 community contributors:**",
        "- @alice:",
        "  - feat: improve output",
        "- @bob:",
        "  - fix(cli): handle empty notes",
      ].join("\n"),
    ]);
  });
});
