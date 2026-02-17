import { describe, expect, test } from "bun:test";
import { getTmuxInstallHint, resolveTmuxInstallGuidance } from "@/lib/diagnostics/tmux-install";

function makeWhich(available: string[]): (command: string) => string | null {
  const commands = new Set(available);
  return (command: string) => (commands.has(command) ? `/usr/bin/${command}` : null);
}

describe("resolveTmuxInstallGuidance", () => {
  test("returns brew install guidance on darwin when brew is available", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "darwin",
      which: makeWhich(["brew"]),
    });

    expect(guidance.commandArgs).toEqual(["brew", "install", "tmux"]);
    expect(guidance.commandDisplay).toBe("brew install tmux");
    expect(guidance.nextActions).toEqual(["Run: brew install tmux"]);
  });

  test("returns fallback darwin guidance with recheck when brew is unavailable", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "darwin",
      which: makeWhich([]),
      recheckCommand: "rr doctor",
    });

    expect(guidance.commandArgs).toBeNull();
    expect(guidance.commandDisplay).toBeNull();
    expect(guidance.nextActions).toEqual([
      "Install Homebrew from https://brew.sh/",
      "Run: brew install tmux",
      "Then run: rr doctor",
    ]);
  });

  test("returns linux command with sudo when both apt-get and sudo are available", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "linux",
      which: makeWhich(["apt-get", "sudo"]),
    });

    expect(guidance.commandArgs).toEqual(["sudo", "apt-get", "install", "-y", "tmux"]);
    expect(guidance.commandDisplay).toBe("sudo apt-get install -y tmux");
    expect(guidance.nextActions).toEqual(["Run: sudo apt-get install -y tmux"]);
  });

  test("returns linux command without sudo when only apt-get is available", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "linux",
      which: makeWhich(["apt-get"]),
    });

    expect(guidance.commandArgs).toEqual(["apt-get", "install", "-y", "tmux"]);
    expect(guidance.commandDisplay).toBe("apt-get install -y tmux");
    expect(guidance.nextActions).toEqual(["Run: apt-get install -y tmux"]);
  });

  test("returns fallback linux guidance without recheck when no package manager is found", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "linux",
      which: makeWhich([]),
    });

    expect(guidance.commandArgs).toBeNull();
    expect(guidance.commandDisplay).toBeNull();
    expect(guidance.nextActions).toEqual([
      "Run one of: apt-get install -y tmux, dnf install -y tmux, yum install -y tmux, pacman -S --noconfirm tmux, zypper install -y tmux (prefix with sudo when required)",
    ]);
  });

  test("returns win32 command when choco is available", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "win32",
      which: makeWhich(["choco"]),
    });

    expect(guidance.commandArgs).toEqual(["choco", "install", "tmux", "-y"]);
    expect(guidance.commandDisplay).toBe("choco install tmux -y");
    expect(guidance.nextActions).toEqual(["Run: choco install tmux -y"]);
  });

  test("returns fallback win32 guidance with recheck when package managers are unavailable", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "win32",
      which: makeWhich([]),
      recheckCommand: "rr doctor",
    });

    expect(guidance.commandArgs).toBeNull();
    expect(guidance.commandDisplay).toBeNull();
    expect(guidance.nextActions).toEqual([
      "Run one of: winget install --id GnuWin32.Tmux -e, choco install tmux -y, scoop install tmux",
      "Then run: rr doctor",
    ]);
  });

  test("returns generic fallback guidance for unsupported platforms", () => {
    const guidance = resolveTmuxInstallGuidance({
      platform: "freebsd" as NodeJS.Platform,
      which: makeWhich([]),
      recheckCommand: "rr doctor",
    });

    expect(guidance.commandArgs).toBeNull();
    expect(guidance.commandDisplay).toBeNull();
    expect(guidance.nextActions).toEqual([
      "Install tmux using your platform package manager.",
      "Then run: rr doctor",
    ]);
  });
});

describe("getTmuxInstallHint", () => {
  test("returns resolved command when available", () => {
    const hint = getTmuxInstallHint({
      platform: "darwin",
      which: makeWhich(["brew"]),
    });

    expect(hint).toBe("brew install tmux");
  });

  test("returns darwin fallback hint when no installer is detected", () => {
    const hint = getTmuxInstallHint({
      platform: "darwin",
      which: makeWhich([]),
    });

    expect(hint).toBe("brew install tmux");
  });

  test("returns linux fallback hint when no installer is detected", () => {
    const hint = getTmuxInstallHint({
      platform: "linux",
      which: makeWhich([]),
    });

    expect(hint).toBe("apt-get install -y tmux");
  });

  test("returns win32 fallback hint when no installer is detected", () => {
    const hint = getTmuxInstallHint({
      platform: "win32",
      which: makeWhich([]),
    });

    expect(hint).toBe("winget install --id GnuWin32.Tmux -e");
  });

  test("returns generic fallback hint for unsupported platforms", () => {
    const hint = getTmuxInstallHint({
      platform: "freebsd" as NodeJS.Platform,
      which: makeWhich([]),
    });

    expect(hint).toBe("install tmux using your platform package manager");
  });
});
