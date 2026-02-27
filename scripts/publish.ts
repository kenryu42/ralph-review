#!/usr/bin/env bun

import { $ } from "bun";
import { formatReleaseNotes, generateChangelog, getContributors } from "./generate-changelog";

export type BumpType = "major" | "minor" | "patch";
type FetchFn = (input: string | URL) => Promise<Response>;
type Environment = Record<string, string | undefined>;

export const PACKAGE_NAME = "ralph-review";
export const SCHEMA_FILE = "assets/ralph-review.schema.json";
export const RELEASE_FILES = ["package.json", SCHEMA_FILE] as const;
export const NPM_PUBLISH_COMMAND = [
  "npm",
  "publish",
  "--access",
  "public",
  "--provenance",
] as const;

function resolveRepoPath(relativePath: string): string {
  return new URL(`../${relativePath}`, import.meta.url).pathname;
}

export function isBumpType(value: unknown): value is BumpType {
  return value === "major" || value === "minor" || value === "patch";
}

function parseBump(value: string | undefined): BumpType | undefined {
  if (!value) {
    return undefined;
  }
  if (!isBumpType(value)) {
    throw new Error(`Invalid BUMP value "${value}". Use major, minor, or patch.`);
  }
  return value;
}

async function fetchPreviousVersion(fetchFn: FetchFn = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
    if (!res.ok) {
      if (res.status === 404) {
        console.log("Package not found on npm - this appears to be the first publish");
        return "0.0.0";
      }
      throw new Error(`Failed to fetch: ${res.statusText}`);
    }
    const data = (await res.json()) as { version: string };
    console.log(`Previous version: ${data.version}`);
    return data.version;
  } catch (error) {
    console.error(`Failed to fetch previous version from npm: ${error}`);
    return null;
  }
}

export function bumpVersion(version: string, type: BumpType): string {
  const parts = version.split(".").map((part) => Number(part));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function replacePackageVersion(packageJson: string, newVersion: string): string {
  const versionPattern = /"version"\s*:\s*"[^"]+"/;
  if (!versionPattern.test(packageJson)) {
    throw new Error("Could not find version field in package.json");
  }
  return packageJson.replace(versionPattern, `"version": "${newVersion}"`);
}

async function updatePackageVersion(newVersion: string): Promise<void> {
  const packagePath = resolveRepoPath("package.json");
  const packageJson = await Bun.file(packagePath).text();
  await Bun.write(packagePath, replacePackageVersion(packageJson, newVersion));
  console.log(`Updated: ${packagePath}`);
}

async function revertVersionChanges(): Promise<void> {
  await $`git checkout -- package.json ${SCHEMA_FILE}`.nothrow();
}

async function build(): Promise<void> {
  console.log("\nBuilding...");
  const buildResult = Bun.spawnSync(["bun", "run", "build:schema"]);
  if (buildResult.exitCode !== 0) {
    console.error("Build failed");
    console.error(buildResult.stderr.toString());
    throw new Error("Build failed");
  }
}

async function npmPublish(): Promise<void> {
  console.log("Publishing to npm...");
  const publishResult = Bun.spawnSync([...NPM_PUBLISH_COMMAND]);
  if (publishResult.exitCode !== 0) {
    console.error("npm publish failed");
    console.error(publishResult.stderr.toString());
    throw new Error("npm publish failed");
  }
}

async function gitCommitTagPush(newVersion: string): Promise<void> {
  console.log("\nCommitting and tagging...");
  await $`git config user.email "github-actions[bot]@users.noreply.github.com"`;
  await $`git config user.name "github-actions[bot]"`;
  await $`git add package.json ${SCHEMA_FILE}`;

  const hasStagedChanges = await $`git diff --cached --quiet`.nothrow();
  if (hasStagedChanges.exitCode !== 0) {
    await $`git commit -m "release: v${newVersion}"`;
  } else {
    console.log("No changes to commit (version already updated)");
  }

  const tagExists = await $`git rev-parse v${newVersion}`.nothrow();
  if (tagExists.exitCode !== 0) {
    await $`git tag v${newVersion}`;
  } else {
    // Tag exists but registry doesn't have this version (checked before calling this function).
    // This is a retry after a failed previous publish, so we force-update the tag to HEAD.
    console.log(
      `Tag v${newVersion} exists from failed previous publish - updating to current HEAD`
    );
    await $`git tag -f v${newVersion}`;
  }

  await $`git push origin HEAD`;
  // Force push the tag in case we updated an existing one from a failed previous run
  await $`git push origin v${newVersion} --force`;
}

async function createGitHubRelease(newVersion: string, notes: string[]): Promise<void> {
  console.log("\nCreating GitHub release...");
  const releaseNotes = notes.length > 0 ? notes.join("\n") : "No notable changes";
  const releaseExists = await $`gh release view v${newVersion}`.nothrow();
  if (releaseExists.exitCode !== 0) {
    await $`gh release create v${newVersion} --title "v${newVersion}" --notes ${releaseNotes}`;
  } else {
    console.log(`Release v${newVersion} already exists`);
  }
}

/**
 * Check if a version exists on npm.
 * @returns `true` if version exists, `false` if definitely absent (404), `null` if uncertain (network error)
 */
async function checkVersionExists(
  version: string,
  fetchFn: FetchFn = fetch
): Promise<boolean | null> {
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${PACKAGE_NAME}/${version}`);
    if (res.ok) return true;
    if (res.status === 404) return false;
    // Other HTTP errors (5xx, rate limiting, etc.) - state is uncertain
    console.warn(`npm registry returned ${res.status} for version check - treating as uncertain`);
    return null;
  } catch (error) {
    // Network error - state is uncertain
    console.warn(`npm registry check failed: ${error} - treating as uncertain`);
    return null;
  }
}

export function collectUnexpectedChanges(
  status: string,
  allowedFiles: readonly string[] = RELEASE_FILES
): string[] {
  return status
    .split("\n")
    .filter((line) => line.trim())
    .filter((line) => !allowedFiles.some((file) => line.includes(file)));
}

async function preflight(
  newVersion: string,
  previousVersion: string,
  isDryRun: boolean
): Promise<void> {
  console.log("\n🔍 Running preflight checks...\n");

  // 1. Ensure working directory is clean (except expected changes)
  const status = await $`git status --porcelain`.text();

  if (isDryRun) {
    // Dry-run requires completely clean working directory to avoid data loss
    if (status.trim()) {
      console.error(`❌ Dry-run requires clean working directory. Uncommitted changes:\n${status}`);
      process.exit(1);
    }
  } else {
    // CI allows expected changes from version updates (for recovery scenarios)
    const unexpectedChanges = collectUnexpectedChanges(status);
    if (unexpectedChanges.length > 0) {
      console.error(`❌ Unexpected uncommitted changes:\n${unexpectedChanges.join("\n")}`);
      process.exit(1);
    }
  }
  console.log("  ✓ Working directory is clean");

  // 2. Verify previous tag exists for changelog
  const prevTag = `v${previousVersion}`;
  const tagCheck = await $`git rev-parse ${prevTag}`.nothrow().quiet();
  if (tagCheck.exitCode !== 0) {
    console.warn(`  ⚠️  Previous tag ${prevTag} not found - changelog will include all commits`);
  } else {
    console.log(`  ✓ Previous tag ${prevTag} exists`);
  }

  // 3. Verify version doesn't already have a tag
  const newTag = `v${newVersion}`;
  const newTagCheck = await $`git rev-parse ${newTag}`.nothrow().quiet();
  if (newTagCheck.exitCode === 0) {
    console.warn(`  ⚠️  Tag ${newTag} already exists`);
  }

  console.log("\n✅ Preflight checks passed\n");
}

async function runRecovery(executeRecovery: boolean, fetchFn: FetchFn = fetch): Promise<void> {
  console.log("🔧 Recovery mode: checking for partial publish state...\n");

  // Get version from npm - fail fast if we can't determine the version
  const npmVersion = await fetchPreviousVersion(fetchFn);
  if (npmVersion === null) {
    console.error("❌ Cannot determine npm version - recovery aborted");
    console.error(
      "   Fix npm connectivity or specify VERSION explicitly if this is a first publish."
    );
    process.exit(1);
  }

  // Guard against 404 returning "0.0.0" - verify version actually exists
  if (npmVersion === "0.0.0") {
    const exists = await checkVersionExists("0.0.0", fetchFn);
    if (exists === null) {
      console.error("❌ Cannot verify if 0.0.0 exists on npm - recovery aborted");
      console.error("   Retry when npm is reachable.");
      process.exit(1);
    }
    if (exists === false) {
      console.error("❌ Package not found on npm - nothing to recover");
      console.error("   Use normal publish flow for first publish.");
      process.exit(1);
    }
  }

  // Check if tag exists
  const tagExists = await $`git rev-parse v${npmVersion}`.nothrow();

  // Check if release exists
  const releaseExists = await $`gh release view v${npmVersion}`.nothrow();

  console.log(`\nnpm version: ${npmVersion}`);
  console.log(`Git tag v${npmVersion}: ${tagExists.exitCode === 0 ? "✅ exists" : "❌ missing"}`);
  console.log(`GitHub release: ${releaseExists.exitCode === 0 ? "✅ exists" : "❌ missing"}`);

  if (tagExists.exitCode === 0 && releaseExists.exitCode === 0) {
    console.log("\n✅ No recovery needed - all artifacts exist");
    return;
  }

  if (!executeRecovery) {
    console.log("\nUse --recover --execute to create missing artifacts.");
    return;
  }

  // Execute recovery
  console.log("\nExecuting recovery...");

  if (tagExists.exitCode !== 0) {
    const headSha = (await $`git rev-parse --short HEAD`.text()).trim();
    const branch = (await $`git branch --show-current`.text()).trim();
    console.warn(`⚠️  Warning: Will tag current HEAD (${headSha} on ${branch})`);
    console.warn(`   Ensure this is the commit that was published to npm!`);
    console.log(`Creating missing tag v${npmVersion}...`);
    await $`git tag v${npmVersion}`;
    await $`git push origin v${npmVersion}`;
  }

  if (releaseExists.exitCode !== 0) {
    console.log(`Creating missing release v${npmVersion}...`);
    await $`gh release create v${npmVersion} --title "v${npmVersion}" --notes "Recovery release"`;
  }

  console.log("\n✅ Recovery complete");
}

async function runDryRun(newVersion: string, previousVersion: string): Promise<void> {
  console.log("\n[DRY-RUN] Simulating full publish flow...\n");

  // Run preflight before any modifications
  await preflight(newVersion, previousVersion, true);

  try {
    // Actually update version files (we'll revert at the end)
    await updatePackageVersion(newVersion);

    // Actually build
    await build();

    // Stage and check what would be committed
    await $`git add package.json ${SCHEMA_FILE}`;
    const staged = await $`git diff --cached --stat`.text();
    console.log("[DRY-RUN] Would commit:");
    console.log(staged);

    // Generate changelog preview
    const changelog = await generateChangelog(`v${previousVersion}`);
    const contributors = await getContributors(`v${previousVersion}`);
    const notes = formatReleaseNotes(changelog, contributors);

    console.log("\n--- Release Notes ---");
    console.log(notes.length > 0 ? notes.join("\n") : "No notable changes");

    console.log(`\n[DRY-RUN] ✅ All checks passed - would publish ${PACKAGE_NAME}@${newVersion}`);
  } catch (error) {
    console.error("\n[DRY-RUN] ❌ Simulation failed");
    throw error;
  } finally {
    // Always cleanup: unstage and revert changes
    await $`git reset HEAD`.nothrow();
    await revertVersionChanges();
  }
}

export async function runPublish(
  options: { argv?: readonly string[]; env?: Environment; fetchFn?: FetchFn } = {}
): Promise<void> {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const fetchFn = options.fetchFn ?? fetch;
  const bump = parseBump(env.BUMP);
  const versionOverride = env.VERSION;
  const dryRun = argv.includes("--dry-run");
  const recoverMode = argv.includes("--recover");
  const executeRecovery = argv.includes("--execute");

  console.log(`=== ${dryRun ? "[DRY-RUN] " : ""}Publishing ${PACKAGE_NAME} ===\n`);

  // Recovery mode
  if (recoverMode) {
    await runRecovery(executeRecovery, fetchFn);
    return;
  }

  const previous = await fetchPreviousVersion(fetchFn);

  // If npm lookup failed and no explicit version override, fail fast
  if (previous === null && !versionOverride) {
    console.error("❌ Cannot determine previous version from npm");
    console.error("   Set VERSION=x.y.z explicitly to proceed.");
    process.exit(1);
  }

  // For changelog/preflight, use previous if available, otherwise use a placeholder
  // (This only happens when VERSION override is used with npm down - changelog will be incomplete)
  const previousForChangelog = previous ?? "0.0.0";

  // Use override, or bump from previous
  const newVersion =
    versionOverride ||
    (bump ? bumpVersion(previousForChangelog, bump) : bumpVersion(previousForChangelog, "patch"));
  console.log(`New version: ${newVersion}\n`);

  // Dry-run mode with full simulation
  if (dryRun) {
    await runDryRun(newVersion, previousForChangelog);
    return;
  }

  // Check if version already exists on npm
  const versionExists = await checkVersionExists(newVersion, fetchFn);
  if (versionExists === true) {
    console.log(`Version ${newVersion} already exists on npm. Skipping publish.`);
    process.exit(0);
  }
  if (versionExists === null) {
    console.error(`❌ Cannot confirm version ${newVersion} is unpublished (npm check failed)`);
    console.error("   Refusing to proceed - could corrupt existing release tag.");
    console.error("   Retry when npm is reachable, or use --recover for manual recovery.");
    process.exit(1);
  }

  // Only run in CI for actual publish
  if (!env.CI) {
    console.log("Not in CI environment. Use --dry-run to test locally.");
    process.exit(1);
  }

  // Run preflight checks
  await preflight(newVersion, previousForChangelog, false);

  // Update release files
  await updatePackageVersion(newVersion);

  // Generate changelog before building
  const changelog = await generateChangelog(`v${previousForChangelog}`);
  const contributors = await getContributors(`v${previousForChangelog}`);
  const notes = formatReleaseNotes(changelog, contributors);

  // Build with new version
  await build();

  // Git commit, tag, and push FIRST (reversible via force-push if needed)
  await gitCommitTagPush(newVersion);

  // Only publish to npm AFTER git is successful (irreversible)
  await npmPublish();

  // Create GitHub release last (easily recoverable)
  await createGitHubRelease(newVersion, notes);

  console.log(`\n=== Successfully published ${PACKAGE_NAME}@${newVersion} ===`);
}

if (import.meta.main) {
  runPublish().catch((error) => {
    console.error(`Publish failed: ${error}`);
    process.exit(1);
  });
}
