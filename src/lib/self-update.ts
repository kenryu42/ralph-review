import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type UpdateManager = "npm" | "brew";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SelfUpdateDependencies {
  cliPath: string;
  getCurrentVersion: () => string | Promise<string>;
  which: (command: string) => string | null;
  runText: (command: string[]) => Promise<CommandResult>;
  runInteractive: (command: string[]) => Promise<number>;
}

export interface SelfUpdateOptions {
  checkOnly: boolean;
  manager?: UpdateManager;
}

export type SelfUpdateResult =
  | {
      status: "up-to-date";
      manager: UpdateManager;
      currentVersion: string;
      latestVersion?: string;
    }
  | {
      status: "update-available";
      manager: UpdateManager;
      currentVersion: string;
      latestVersion?: string;
    }
  | {
      status: "updated";
      manager: UpdateManager;
      previousVersion: string;
      finalVersion: string;
      latestVersion?: string;
    };

const PACKAGE_NAME = "ralph-review";
const BREW_TAP_FORMULA = "kenryu42/tap/ralph-review";
const NPM_INSTALL_COMMAND = ["npm", "install", "-g", `${PACKAGE_NAME}@latest`] as const;
const BREW_INSTALL_COMMAND = ["brew", "install", BREW_TAP_FORMULA] as const;
const BREW_INSTALLED_VERSION_ERROR =
  "Could not determine the installed Homebrew version for ralph-review.";
const BREW_LATEST_VERSION_ERROR =
  "Could not determine the latest Homebrew version for ralph-review.";
const NPM_INSTALLED_VERSION_ERROR =
  "Could not determine the installed npm version for ralph-review.";
const VERSION_COMPARE_ERROR =
  "Could not compare the installed and latest versions for ralph-review.";

export class SelfUpdateError extends Error {
  constructor(
    message: string,
    public readonly notes: string[] = []
  ) {
    super(message);
    this.name = "SelfUpdateError";
  }
}

export function isUpdateManager(value: unknown): value is UpdateManager {
  return value === "npm" || value === "brew";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePath(filePath: string): string {
  return resolve(filePath);
}

function isPathWithin(filePath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function buildDetectionNotes(): string[] {
  return [
    "Run: rr update --manager npm",
    "Run: rr update --manager brew",
    `Run: ${NPM_INSTALL_COMMAND.join(" ")}`,
    `Run: ${BREW_INSTALL_COMMAND.join(" ")}`,
  ];
}

function buildSourceNotes(): string[] {
  return ["Update with git pull, or install globally to enable self-update."];
}

function commandDisplay(command: readonly string[]): string {
  return command.join(" ");
}

function managerDisplay(manager: UpdateManager): string {
  switch (manager) {
    case "brew":
      return "Homebrew";
    case "npm":
      return "npm";
  }
}

function managerManualCommand(manager: UpdateManager): string {
  switch (manager) {
    case "brew":
      return commandDisplay(BREW_INSTALL_COMMAND);
    case "npm":
      return commandDisplay(NPM_INSTALL_COMMAND);
  }
}

async function readTextOutput(
  deps: Pick<SelfUpdateDependencies, "runText">,
  command: string[],
  errorMessage: string
): Promise<string> {
  const result = await deps.runText(command);
  if (result.exitCode !== 0) {
    const notes = result.stderr.trim() ? [result.stderr.trim()] : [];
    throw new SelfUpdateError(errorMessage, notes);
  }
  return result.stdout.trim();
}

function getPackageJsonPath(cliPath: string): string {
  const resolvedCliPath = normalizePath(cliPath);
  return join(dirname(dirname(resolvedCliPath)), "package.json");
}

async function readPackageVersion(cliPath: string): Promise<string> {
  const packageJsonPath = getPackageJsonPath(cliPath);
  const pkg = (await Bun.file(packageJsonPath).json()) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.trim().length === 0) {
    throw new Error(`Could not determine version from ${packageJsonPath}`);
  }
  return pkg.version.trim();
}

async function readSpawnStream(
  stream: ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!stream) {
    return "";
  }

  return new Response(stream).text();
}

export function getDefaultSelfUpdateDependencies(
  cliPath: string = process.argv[1] ?? resolve(import.meta.dir, "../cli.ts")
): SelfUpdateDependencies {
  return {
    cliPath,
    getCurrentVersion: () => readPackageVersion(cliPath),
    which: Bun.which,
    runText: async (command: string[]) => {
      const proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        readSpawnStream(proc.stdout),
        readSpawnStream(proc.stderr),
      ]);

      return {
        stdout,
        stderr,
        exitCode,
      };
    },
    runInteractive: async (command: string[]) => {
      const proc = Bun.spawn(command, {
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });

      return proc.exited;
    },
  };
}

async function detectNpmMatch(deps: SelfUpdateDependencies, cliPath: string): Promise<boolean> {
  if (!deps.which("npm")) {
    return false;
  }

  const result = await deps.runText(["npm", "prefix", "-g"]);
  if (result.exitCode !== 0) {
    return false;
  }

  const prefix = result.stdout.trim();
  if (!prefix) {
    return false;
  }

  const npmPackageDir = join(prefix, "lib", "node_modules", PACKAGE_NAME);

  return isPathWithin(cliPath, npmPackageDir);
}

async function detectBrewMatch(deps: SelfUpdateDependencies, cliPath: string): Promise<boolean> {
  if (!deps.which("brew")) {
    return false;
  }

  const result = await deps.runText(["brew", "--prefix", "--installed", PACKAGE_NAME]);
  if (result.exitCode !== 0) {
    return false;
  }

  const formulaPrefix = result.stdout.trim();
  if (!formulaPrefix) {
    return false;
  }

  const brewRoot = dirname(dirname(formulaPrefix));
  const brewBinDir = join(brewRoot, "bin");
  const cellarDir = join(brewRoot, "Cellar", PACKAGE_NAME);

  return (
    isPathWithin(cliPath, brewBinDir) ||
    isPathWithin(cliPath, formulaPrefix) ||
    isPathWithin(cliPath, cellarDir)
  );
}

async function isSourceCheckout(
  deps: Pick<SelfUpdateDependencies, "runText" | "which">,
  cliPath: string
): Promise<boolean> {
  if (!deps.which("git")) {
    return false;
  }

  const projectRoot = dirname(dirname(cliPath));
  const result = await deps.runText([
    "git",
    "-C",
    projectRoot,
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export async function detectUpdateManager(deps: SelfUpdateDependencies): Promise<UpdateManager> {
  const cliPath = normalizePath(deps.cliPath);
  const matches: UpdateManager[] = [];

  if (await detectNpmMatch(deps, cliPath)) {
    matches.push("npm");
  }

  if (await detectBrewMatch(deps, cliPath)) {
    matches.push("brew");
  }

  const detectedManager = matches[0];
  if (matches.length === 1 && detectedManager) {
    return detectedManager;
  }

  if (matches.length > 1) {
    throw new SelfUpdateError(
      "Could not determine whether ralph-review was installed with npm or Homebrew.",
      buildDetectionNotes()
    );
  }

  if (await isSourceCheckout(deps, cliPath)) {
    throw new SelfUpdateError(
      "Self-update is not available when running from source.",
      buildSourceNotes()
    );
  }

  throw new SelfUpdateError(
    "Could not determine how ralph-review was installed.",
    buildDetectionNotes()
  );
}

function ensureManagerAvailable(manager: UpdateManager, deps: SelfUpdateDependencies): void {
  if (deps.which(manager)) {
    return;
  }

  throw new SelfUpdateError(
    `${managerDisplay(manager)} is not installed or not available in PATH.`,
    [`Run: ${managerManualCommand(manager)}`]
  );
}

async function getNpmVersions(
  deps: SelfUpdateDependencies
): Promise<{ currentVersion: string; latestVersion: string }> {
  const currentVersion = await getNpmInstalledVersion(deps);
  const latestVersion = await readTextOutput(
    deps,
    ["npm", "view", PACKAGE_NAME, "version"],
    "Failed to fetch the latest npm version for ralph-review."
  );

  return {
    currentVersion,
    latestVersion,
  };
}

function parseNpmInstalledVersion(output: string): string {
  const parsed = JSON.parse(output) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
    throw new SelfUpdateError(NPM_INSTALLED_VERSION_ERROR);
  }

  const dependency = parsed.dependencies[PACKAGE_NAME];
  if (!isRecord(dependency)) {
    throw new SelfUpdateError(NPM_INSTALLED_VERSION_ERROR);
  }

  if (typeof dependency.version !== "string" || dependency.version.trim().length === 0) {
    throw new SelfUpdateError(NPM_INSTALLED_VERSION_ERROR);
  }

  return dependency.version.trim();
}

async function getNpmInstalledVersion(deps: SelfUpdateDependencies): Promise<string> {
  const output = await readTextOutput(
    deps,
    ["npm", "list", "-g", PACKAGE_NAME, "--json", "--depth=0"],
    "Failed to read the installed npm version for ralph-review."
  );

  return parseNpmInstalledVersion(output);
}

function hasNewerVersion(currentVersion: string, latestVersion: string): boolean {
  try {
    return compareVersions(latestVersion, currentVersion) === 1;
  } catch {
    throw new SelfUpdateError(VERSION_COMPARE_ERROR, [
      `Installed version: ${currentVersion}`,
      `Latest version: ${latestVersion}`,
    ]);
  }
}

function parseVersionRevision(version: string): { version: string; revision: number } {
  const trimmed = version.trim();
  const [baseVersion, revisionSuffix, ...extraSegments] = trimmed.split("_");
  if (!baseVersion || extraSegments.length > 0) {
    throw new Error(`Invalid version: ${version}`);
  }

  if (revisionSuffix === undefined) {
    return { version: baseVersion, revision: 0 };
  }

  if (!/^\d+$/.test(revisionSuffix)) {
    throw new Error(`Invalid revisioned version: ${version}`);
  }

  return { version: baseVersion, revision: Number.parseInt(revisionSuffix, 10) };
}

function compareVersions(leftVersion: string, rightVersion: string): number {
  const left = parseVersionRevision(leftVersion);
  const right = parseVersionRevision(rightVersion);
  const versionOrder = Bun.semver.order(left.version, right.version);

  if (versionOrder !== 0) {
    return versionOrder;
  }

  if (left.revision > right.revision) {
    return 1;
  }

  if (left.revision < right.revision) {
    return -1;
  }

  return 0;
}

function formatBrewVersion(version: string, revision: number): string {
  return revision > 0 ? `${version}_${revision}` : version;
}

function parseBrewVersions(output: string): { currentVersion: string; latestVersion: string } {
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new SelfUpdateError(BREW_INSTALLED_VERSION_ERROR);
  }

  const formula = parsed[0];
  if (!isRecord(formula) || !Array.isArray(formula.installed)) {
    throw new SelfUpdateError(BREW_INSTALLED_VERSION_ERROR);
  }

  let currentVersion = "";

  const linkedKeg = typeof formula.linked_keg === "string" ? formula.linked_keg.trim() : "";
  if (linkedKeg) {
    for (const installed of formula.installed) {
      if (
        isRecord(installed) &&
        typeof installed.version === "string" &&
        installed.version.trim() === linkedKeg
      ) {
        currentVersion = linkedKeg;
        break;
      }
    }
  }

  if (!currentVersion) {
    for (const installed of formula.installed) {
      if (
        isRecord(installed) &&
        typeof installed.version === "string" &&
        installed.version.trim()
      ) {
        currentVersion = installed.version.trim();
        break;
      }
    }
  }

  if (!currentVersion) {
    throw new SelfUpdateError(BREW_INSTALLED_VERSION_ERROR);
  }

  if (
    !isRecord(formula.versions) ||
    typeof formula.versions.stable !== "string" ||
    !formula.versions.stable.trim()
  ) {
    throw new SelfUpdateError(BREW_LATEST_VERSION_ERROR);
  }

  const stableVersion = (formula.versions.stable as string).trim();
  const revision =
    typeof formula.revision === "number" && formula.revision > 0 ? formula.revision : 0;
  const latestVersion = formatBrewVersion(stableVersion, revision);

  return { currentVersion, latestVersion };
}

async function getBrewVersions(
  deps: SelfUpdateDependencies
): Promise<{ currentVersion: string; latestVersion: string }> {
  const output = await readTextOutput(
    deps,
    ["brew", "info", "--json=v1", PACKAGE_NAME],
    "Failed to read Homebrew formula info for ralph-review."
  );

  return parseBrewVersions(output);
}

async function performNpmSelfUpdate(
  options: SelfUpdateOptions,
  deps: SelfUpdateDependencies
): Promise<SelfUpdateResult> {
  ensureManagerAvailable("npm", deps);

  const { currentVersion, latestVersion } = await getNpmVersions(deps);
  if (!hasNewerVersion(currentVersion, latestVersion)) {
    return {
      status: "up-to-date",
      manager: "npm",
      currentVersion,
      latestVersion,
    };
  }

  if (options.checkOnly) {
    return {
      status: "update-available",
      manager: "npm",
      currentVersion,
      latestVersion,
    };
  }

  const exitCode = await deps.runInteractive([...NPM_INSTALL_COMMAND]);
  if (exitCode !== 0) {
    throw new SelfUpdateError(
      `${commandDisplay(NPM_INSTALL_COMMAND)} exited with code ${exitCode}.`
    );
  }

  const finalVersion = await getNpmInstalledVersion(deps);
  return {
    status: "updated",
    manager: "npm",
    previousVersion: currentVersion,
    finalVersion,
    latestVersion,
  };
}

async function performBrewSelfUpdate(
  options: SelfUpdateOptions,
  deps: SelfUpdateDependencies
): Promise<SelfUpdateResult> {
  ensureManagerAvailable("brew", deps);

  const { currentVersion, latestVersion } = await getBrewVersions(deps);
  if (!hasNewerVersion(currentVersion, latestVersion)) {
    return {
      status: "up-to-date",
      manager: "brew",
      currentVersion,
      latestVersion,
    };
  }

  if (options.checkOnly) {
    return {
      status: "update-available",
      manager: "brew",
      currentVersion,
      latestVersion,
    };
  }

  const exitCode = await deps.runInteractive([...BREW_INSTALL_COMMAND]);
  if (exitCode !== 0) {
    throw new SelfUpdateError(
      `${commandDisplay(BREW_INSTALL_COMMAND)} exited with code ${exitCode}.`
    );
  }

  const { currentVersion: finalVersion } = await getBrewVersions(deps);
  return {
    status: "updated",
    manager: "brew",
    previousVersion: currentVersion,
    finalVersion,
    latestVersion,
  };
}

export async function performSelfUpdate(
  options: SelfUpdateOptions,
  deps: SelfUpdateDependencies
): Promise<SelfUpdateResult> {
  const manager = options.manager ?? (await detectUpdateManager(deps));

  switch (manager) {
    case "npm":
      return performNpmSelfUpdate(options, deps);
    case "brew":
      return performBrewSelfUpdate(options, deps);
  }
}
