const OSC52_PREFIX = "\u001B]52;c;";
const OSC52_SUFFIX = "\u0007";

interface ClipboardProcess {
  stdin: {
    write: (chunk: string) => void;
    end: () => void;
  };
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
}

export interface ClipboardDeps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  stdoutIsTTY: boolean;
  writeToStdout: (chunk: string) => void;
  which: (command: string) => string | null;
  spawn: (command: string[]) => ClipboardProcess;
}

function createClipboardDeps(): ClipboardDeps {
  return {
    env: process.env,
    platform: process.platform,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    writeToStdout: (chunk: string) => {
      process.stdout.write(chunk);
    },
    which: (command: string) => Bun.which(command),
    spawn: (command: string[]) =>
      Bun.spawn(command, {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "pipe",
      }),
  };
}

function writeOsc52Sequence(text: string, deps: ClipboardDeps): boolean {
  if (!deps.stdoutIsTTY) {
    return false;
  }

  const base64 = Buffer.from(text, "utf8").toString("base64");
  const osc52 = `${OSC52_PREFIX}${base64}${OSC52_SUFFIX}`;
  const wrappedSequence = deps.env.TMUX
    ? `\u001BPtmux;\u001B${osc52}\u001B\\`
    : deps.env.STY
      ? `\u001BP${osc52}\u001B\\`
      : osc52;

  deps.writeToStdout(wrappedSequence);
  return true;
}

function resolveNativeClipboardCommand(deps: ClipboardDeps): string[] | null {
  switch (deps.platform) {
    case "darwin":
      return deps.which("pbcopy") ? ["pbcopy"] : null;
    case "linux":
      if (deps.env.WAYLAND_DISPLAY && deps.which("wl-copy")) {
        return ["wl-copy"];
      }
      if (deps.which("xclip")) {
        return ["xclip", "-selection", "clipboard"];
      }
      if (deps.which("xsel")) {
        return ["xsel", "--clipboard", "--input"];
      }
      return null;
    case "win32":
      if (deps.which("clip.exe")) {
        return ["clip.exe"];
      }
      if (deps.which("clip")) {
        return ["clip"];
      }
      if (deps.which("powershell.exe")) {
        return [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ];
      }
      return null;
    default:
      return null;
  }
}

async function writeNativeClipboard(
  command: string[],
  text: string,
  deps: ClipboardDeps
): Promise<void> {
  const proc = deps.spawn(command);

  proc.stdin.write(text);
  proc.stdin.end();

  const exitCode = await proc.exited;
  if (exitCode === 0) {
    return;
  }

  const stderr = await new Response(proc.stderr).text();
  throw new Error(stderr.trim() || `Clipboard command exited with code ${exitCode}`);
}

export async function copyToClipboard(
  text: string,
  deps: ClipboardDeps = createClipboardDeps()
): Promise<void> {
  const osc52Written = writeOsc52Sequence(text, deps);
  const nativeClipboardCommand = resolveNativeClipboardCommand(deps);

  if (!nativeClipboardCommand) {
    if (osc52Written) {
      return;
    }

    throw new Error("No clipboard command available");
  }

  try {
    await writeNativeClipboard(nativeClipboardCommand, text, deps);
  } catch (error) {
    if (osc52Written) {
      return;
    }

    throw error;
  }
}
