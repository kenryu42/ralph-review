import { describe, expect, test } from "bun:test";
import { type ClipboardDeps, copyToClipboard } from "@/lib/tui/clipboard";

function createDeps(overrides: Partial<ClipboardDeps> = {}): ClipboardDeps {
  const stdoutWrites: string[] = [];

  return {
    env: {},
    platform: "darwin",
    stdoutIsTTY: false,
    writeToStdout: (chunk: string) => {
      stdoutWrites.push(chunk);
    },
    which: () => null,
    spawn: () => ({
      stdin: {
        write() {},
        end() {},
      },
      stderr: new ReadableStream<Uint8Array>(),
      exited: Promise.resolve(0),
    }),
    ...overrides,
  };
}

describe("copyToClipboard", () => {
  test("returns successfully when OSC 52 is available and no native command exists", async () => {
    const stdoutWrites: string[] = [];
    const deps = createDeps({
      stdoutIsTTY: true,
      writeToStdout: (chunk: string) => {
        stdoutWrites.push(chunk);
      },
    });

    await expect(copyToClipboard("hello", deps)).resolves.toBeUndefined();

    expect(stdoutWrites).toHaveLength(1);
    expect(stdoutWrites[0]).toContain("]52;c;");
  });

  test("uses the native clipboard command when one is available", async () => {
    const writtenChunks: string[] = [];
    const spawnedCommands: string[][] = [];
    const deps = createDeps({
      which: (command: string) => (command === "pbcopy" ? "/usr/bin/pbcopy" : null),
      spawn: (command: string[]) => {
        spawnedCommands.push(command);
        return {
          stdin: {
            write(chunk: string) {
              writtenChunks.push(chunk);
            },
            end() {},
          },
          stderr: new ReadableStream<Uint8Array>(),
          exited: Promise.resolve(0),
        };
      },
    });

    await expect(copyToClipboard("native copy", deps)).resolves.toBeUndefined();

    expect(spawnedCommands).toEqual([["pbcopy"]]);
    expect(writtenChunks).toEqual(["native copy"]);
  });

  test("throws when neither OSC 52 nor a native clipboard command is available", async () => {
    const deps = createDeps({
      stdoutIsTTY: false,
    });

    await expect(copyToClipboard("hello", deps)).rejects.toThrow("No clipboard command available");
  });

  test("falls back to OSC 52 when the native clipboard command fails", async () => {
    const stdoutWrites: string[] = [];
    const deps = createDeps({
      stdoutIsTTY: true,
      writeToStdout: (chunk: string) => {
        stdoutWrites.push(chunk);
      },
      which: (command: string) => (command === "pbcopy" ? "/usr/bin/pbcopy" : null),
      spawn: () => ({
        stdin: {
          write() {},
          end() {},
        },
        stderr: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("pbcopy failed"));
            controller.close();
          },
        }),
        exited: Promise.resolve(1),
      }),
    });

    await expect(copyToClipboard("hello", deps)).resolves.toBeUndefined();

    expect(stdoutWrites).toHaveLength(1);
    expect(stdoutWrites[0]).toContain("]52;c;");
  });
});
