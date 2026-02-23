#!/usr/bin/env bun

import { $ } from "bun";

export type CommandRunner = (
  strings: TemplateStringsArray,
  ...values: readonly string[]
) => { text: () => Promise<string> };

const DEFAULT_RUNNER: CommandRunner = $;

export const EXCLUDED_AUTHORS = ["actions-user", "github-actions[bot]", "kenryu42"];

/** Regex to match included commit types (with optional scope) */
export const INCLUDED_COMMIT_PATTERN = /^(feat|fix)(\([^)]+\))?:/i;

export const REPO = process.env.GITHUB_REPOSITORY ?? "kenryu42/ralph-review";

/**
 * Check if a commit message should be included in the changelog.
 * @param message - The commit message (can include hash prefix like "abc1234 feat: message")
 */
export function isIncludedCommit(message: string): boolean {
  // Remove optional hash prefix (e.g., "abc1234 " from git log output)
  const messageWithoutHash = message.replace(/^\w+\s+/, "");

  return INCLUDED_COMMIT_PATTERN.test(messageWithoutHash);
}

export async function getLatestReleasedTag(
  runner: CommandRunner = DEFAULT_RUNNER
): Promise<string | null> {
  try {
    const tag =
      await runner`gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty'`.text();
    return tag.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Format changelog and contributors into release notes.
 */
export function formatReleaseNotes(changelog: string[], contributors: string[]): string[] {
  const notes: string[] = [];

  if (changelog.length > 0) {
    notes.push(...changelog);
  } else {
    notes.push("No changes in this release");
  }

  // Contributors section
  if (contributors.length > 0) {
    notes.push(...contributors);
  }

  return notes;
}

export async function generateChangelog(
  previousTag: string,
  runner: CommandRunner = DEFAULT_RUNNER
): Promise<string[]> {
  const result: string[] = [];

  try {
    const log = await runner`git log ${previousTag}..HEAD --oneline --format="%h %s"`.text();
    const commits = log.split("\n").filter((line) => line && isIncludedCommit(line));

    for (const commit of commits) {
      result.push(`- ${commit}`);
    }
  } catch {
    // No commits found
  }

  return result;
}

export async function getContributors(
  previousTag: string,
  runner: CommandRunner = DEFAULT_RUNNER
): Promise<string[]> {
  return getContributorsForRepo(previousTag, REPO, runner);
}

export async function getContributorsForRepo(
  previousTag: string,
  repo: string,
  runner: CommandRunner = DEFAULT_RUNNER
): Promise<string[]> {
  const notes: string[] = [];

  try {
    const compare =
      await runner`gh api "/repos/${repo}/compare/${previousTag}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text();
    const contributors = new Map<string, string[]>();

    for (const line of compare.split("\n").filter(Boolean)) {
      const { login, message } = JSON.parse(line) as {
        login: string | null;
        message: string;
      };
      const title = message.split("\n")[0] ?? "";
      if (!isIncludedCommit(title)) continue;

      if (login && !EXCLUDED_AUTHORS.includes(login)) {
        if (!contributors.has(login)) contributors.set(login, []);
        contributors.get(login)?.push(title);
      }
    }

    if (contributors.size > 0) {
      notes.push("");
      notes.push(
        `**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`
      );
      for (const [username, userCommits] of contributors) {
        notes.push(`- @${username}:`);
        for (const commit of userCommits) {
          notes.push(`  - ${commit}`);
        }
      }
    }
  } catch {
    // Failed to fetch contributors
  }

  return notes;
}

export type RunChangelogOptions = {
  runner?: CommandRunner;
  log?: (message: string) => void;
};

export async function runChangelog(options: RunChangelogOptions = {}): Promise<void> {
  const runner = options.runner ?? DEFAULT_RUNNER;
  const log = options.log ?? console.log;
  const previousTag = await getLatestReleasedTag(runner);

  if (!previousTag) {
    log("Initial release");
    return;
  }

  const changelog = await generateChangelog(previousTag, runner);
  const contributors = await getContributorsForRepo(previousTag, REPO, runner);
  const notes = formatReleaseNotes(changelog, contributors);

  log(notes.join("\n"));
}

if (import.meta.main) {
  runChangelog();
}
