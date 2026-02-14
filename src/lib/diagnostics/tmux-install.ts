interface InstallCandidate {
  binary: string;
  args: string[];
}

export interface TmuxInstallGuidance {
  commandArgs: string[] | null;
  commandDisplay: string | null;
  nextActions: string[];
}

interface ResolveTmuxInstallGuidanceOptions {
  platform?: NodeJS.Platform;
  which?: (command: string) => string | null;
  recheckCommand?: string;
}

const LINUX_CANDIDATES: readonly InstallCandidate[] = [
  { binary: "apt-get", args: ["apt-get", "install", "-y", "tmux"] },
  { binary: "dnf", args: ["dnf", "install", "-y", "tmux"] },
  { binary: "yum", args: ["yum", "install", "-y", "tmux"] },
  { binary: "pacman", args: ["pacman", "-S", "--noconfirm", "tmux"] },
  { binary: "zypper", args: ["zypper", "install", "-y", "tmux"] },
];

const WINDOWS_CANDIDATES: readonly InstallCandidate[] = [
  { binary: "winget", args: ["winget", "install", "--id", "GnuWin32.Tmux", "-e"] },
  { binary: "choco", args: ["choco", "install", "tmux", "-y"] },
  { binary: "scoop", args: ["scoop", "install", "tmux"] },
];

function asCommandDisplay(args: string[]): string {
  return args.join(" ");
}

function withOptionalRecheck(actions: string[], recheckCommand?: string): string[] {
  if (!recheckCommand) {
    return actions;
  }
  return [...actions, `Then run: ${recheckCommand}`];
}

function firstAvailableCandidate(
  candidates: readonly InstallCandidate[],
  whichCommand: (command: string) => string | null
): InstallCandidate | null {
  for (const candidate of candidates) {
    if (whichCommand(candidate.binary)) {
      return candidate;
    }
  }

  return null;
}

function fallbackActionsForPlatform(platform: NodeJS.Platform, recheckCommand?: string): string[] {
  switch (platform) {
    case "darwin":
      return withOptionalRecheck(
        ["Install Homebrew from https://brew.sh/", "Run: brew install tmux"],
        recheckCommand
      );
    case "linux":
      return withOptionalRecheck(
        [
          "Run one of: apt-get install -y tmux, dnf install -y tmux, yum install -y tmux, " +
            "pacman -S --noconfirm tmux, zypper install -y tmux (prefix with sudo when required)",
        ],
        recheckCommand
      );
    case "win32":
      return withOptionalRecheck(
        [
          "Run one of: winget install --id GnuWin32.Tmux -e, choco install tmux -y, scoop install tmux",
        ],
        recheckCommand
      );
    default:
      return withOptionalRecheck(
        ["Install tmux using your platform package manager."],
        recheckCommand
      );
  }
}

const DARWIN_CANDIDATE: InstallCandidate = {
  binary: "brew",
  args: ["brew", "install", "tmux"],
};

function candidateForPlatform(
  platform: NodeJS.Platform,
  whichCommand: (command: string) => string | null
): InstallCandidate | null {
  if (platform === "darwin") {
    return whichCommand(DARWIN_CANDIDATE.binary) ? DARWIN_CANDIDATE : null;
  }
  if (platform === "linux") {
    const candidate = firstAvailableCandidate(LINUX_CANDIDATES, whichCommand);
    if (!candidate) {
      return null;
    }

    if (!whichCommand("sudo")) {
      return candidate;
    }

    return {
      binary: candidate.binary,
      args: ["sudo", ...candidate.args],
    };
  }
  if (platform === "win32") {
    return firstAvailableCandidate(WINDOWS_CANDIDATES, whichCommand);
  }
  return null;
}

export function resolveTmuxInstallGuidance(
  options: ResolveTmuxInstallGuidanceOptions = {}
): TmuxInstallGuidance {
  const platform = options.platform ?? process.platform;
  const whichCommand = options.which ?? Bun.which;
  const recheckCommand = options.recheckCommand;

  const candidate = candidateForPlatform(platform, whichCommand);
  if (candidate) {
    return {
      commandArgs: candidate.args,
      commandDisplay: asCommandDisplay(candidate.args),
      nextActions: withOptionalRecheck(
        [`Run: ${asCommandDisplay(candidate.args)}`],
        recheckCommand
      ),
    };
  }

  return {
    commandArgs: null,
    commandDisplay: null,
    nextActions: fallbackActionsForPlatform(platform, recheckCommand),
  };
}

export function getTmuxInstallHint(
  options: Omit<ResolveTmuxInstallGuidanceOptions, "recheckCommand"> = {}
): string {
  const guidance = resolveTmuxInstallGuidance(options);
  if (guidance.commandDisplay) {
    return guidance.commandDisplay;
  }

  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return "brew install tmux";
  }
  if (platform === "linux") {
    return "apt-get install -y tmux";
  }
  if (platform === "win32") {
    return "winget install --id GnuWin32.Tmux -e";
  }

  return "install tmux using your platform package manager";
}
