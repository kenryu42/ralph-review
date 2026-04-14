import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { CLI_PATH } from "@/lib/paths";
import { FixFindingsOverlay } from "@/lib/tui/sessions/fix/FixFindingsOverlay";

function createStderrStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function createFinding(id: `F${string}`, priority: "P0" | "P1" | "P2" | "P3") {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `[${priority}] Finding ${id}`,
    body: `Body for ${id}`,
    priority,
    confidenceScore: 0.91,
    filePath: `src/file-${id}.ts`,
    startLine: 10,
    endLine: 12,
  };
}

describe("FixFindingsOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;
  const originalSpawn = Bun.spawn;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }

    Bun.spawn = originalSpawn;
  });

  async function renderOverlay() {
    let closeCount = 0;

    testSetup = await testRender(
      createElement(FixFindingsOverlay, {
        sessionId: "session-123",
        projectPath: "/repo/project",
        findings: [createFinding("F001", "P0"), createFinding("F002", "P1")],
        onClose: () => {
          closeCount += 1;
        },
      }),
      {
        width: 120,
        height: 36,
      }
    );

    await act(async () => {
      await testSetup?.renderOnce();
    });

    async function press(sequence: string): Promise<string> {
      await act(async () => {
        testSetup?.renderer.keyInput.processInput(sequence);
        await Promise.resolve();
        await testSetup?.renderOnce();
      });

      if (!testSetup) {
        throw new Error("expected rendered overlay");
      }

      return testSetup.captureCharFrame();
    }

    return {
      frame: () => testSetup?.captureCharFrame() ?? "",
      press,
      getCloseCount: () => closeCount,
    };
  }

  test("strips duplicated priority prefixes from finding titles in id mode", async () => {
    const overlay = await renderOverlay();

    let frame = overlay.frame();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (frame.includes("Choose findings")) {
        break;
      }

      frame = await overlay.press("\u001B[C");
    }

    expect(frame).toContain("Choose findings");
    expect(frame).toContain("[P0]");
    expect(frame).toContain("Finding F001");
    expect(frame).not.toContain("[P0] [P0] Finding F001");
  });

  test("spawns rr fix --all by default and closes on success", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    const frame = await overlay.press("\r");

    expect(frame).toContain("Fix Findings");
    expect(spawnCalls).toEqual([
      {
        cmd: [process.execPath, CLI_PATH, "fix", "--session", "session-123", "--all"],
        cwd: "/repo/project",
      },
    ]);
    expect(overlay.getCloseCount()).toBe(1);
  });

  test("spawns rr fix with repeated priority flags", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    await overlay.press(" ");
    await overlay.press("\u001B[B");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(spawnCalls).toEqual([
      {
        cmd: [
          process.execPath,
          CLI_PATH,
          "fix",
          "--session",
          "session-123",
          "--priority",
          "P0",
          "--priority",
          "P1",
        ],
        cwd: "/repo/project",
      },
    ]);
  });

  test("spawns rr fix with repeated id flags", async () => {
    const spawnCalls: Array<{ cmd: string[]; cwd: string | undefined }> = [];
    Bun.spawn = ((cmd: string[], options?: { cwd?: string }) => {
      spawnCalls.push({ cmd, cwd: options?.cwd });
      return {
        exited: Promise.resolve(0),
        stderr: createStderrStream(""),
      };
    }) as typeof Bun.spawn;

    const overlay = await renderOverlay();
    await overlay.press("\u001B[C");
    await overlay.press("\u001B[C");
    await overlay.press(" ");
    await overlay.press("\u001B[B");
    await overlay.press(" ");
    await overlay.press("\r");

    expect(spawnCalls).toEqual([
      {
        cmd: [
          process.execPath,
          CLI_PATH,
          "fix",
          "--session",
          "session-123",
          "--id",
          "F001",
          "--id",
          "F002",
        ],
        cwd: "/repo/project",
      },
    ]);
  });
});
