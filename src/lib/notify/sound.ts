import type { Config } from "@/lib/types";

const PLAYBACK_TIMEOUT_MS = 2500;
const MACOS_SOUND_FILE = "/System/Library/Sounds/Glass.aiff";
const LINUX_PAPLAY_FILE = "/usr/share/sounds/freedesktop/stereo/complete.oga";
const LINUX_APLAY_FILE = "/usr/share/sounds/alsa/Front_Center.wav";

export type RunCompletionClassification = "success" | "warning" | "error";
export type SoundOverride = "on" | "off";

export interface PlayCompletionSoundResult {
  played: boolean;
  reason?: string;
}

interface SoundCommandCandidate {
  label: string;
  command: string[];
}

interface SoundRuntimeDeps {
  platform: NodeJS.Platform;
  which: (command: string) => string | null;
  spawnAndWait: (command: string[], timeoutMs: number) => Promise<boolean>;
  writeBell: () => void;
}

function buildCommandCandidates(platform: NodeJS.Platform): SoundCommandCandidate[] {
  switch (platform) {
    case "darwin":
      return [{ label: "afplay", command: ["afplay", MACOS_SOUND_FILE] }];
    case "linux":
      return [
        { label: "paplay", command: ["paplay", LINUX_PAPLAY_FILE] },
        {
          label: "canberra-gtk-play",
          command: ["canberra-gtk-play", "--id", "complete", "--description", "ralph-review"],
        },
        { label: "aplay", command: ["aplay", LINUX_APLAY_FILE] },
      ];
    default:
      return [];
  }
}

async function spawnAndWait(command: string[], timeoutMs: number): Promise<boolean> {
  try {
    const proc = Bun.spawn(command, {
      stdout: "ignore",
      stderr: "ignore",
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const exitCode = await proc.exited.catch(() => 1);
    clearTimeout(timeoutId);

    return !timedOut && exitCode === 0;
  } catch {
    return false;
  }
}

function getDeps(overrides: Partial<SoundRuntimeDeps>): SoundRuntimeDeps {
  return {
    platform: overrides.platform ?? process.platform,
    which: overrides.which ?? Bun.which,
    spawnAndWait: overrides.spawnAndWait ?? spawnAndWait,
    writeBell: overrides.writeBell ?? (() => process.stdout.write("\u0007")),
  };
}

export function resolveSoundEnabled(config: Config, override?: SoundOverride): boolean {
  if (override === "on") {
    return true;
  }

  if (override === "off") {
    return false;
  }

  return config.notifications.sound.enabled;
}

export async function playCompletionSound(
  classification: RunCompletionClassification,
  overrides: Partial<SoundRuntimeDeps> = {}
): Promise<PlayCompletionSoundResult> {
  void classification;
  const deps = getDeps(overrides);
  const candidates = buildCommandCandidates(deps.platform);
  const attempted: string[] = [];

  for (const candidate of candidates) {
    const executable = candidate.command[0];
    if (!executable || deps.which(executable) === null) {
      continue;
    }

    attempted.push(candidate.label);
    const played = await deps.spawnAndWait(candidate.command, PLAYBACK_TIMEOUT_MS);
    if (played) {
      return { played: true };
    }
  }

  try {
    deps.writeBell();
    return { played: true };
  } catch {
    const attemptedBackends = attempted.length > 0 ? attempted.join(", ") : "none";
    return { played: false, reason: `No usable sound backend (attempted: ${attemptedBackends})` };
  }
}
