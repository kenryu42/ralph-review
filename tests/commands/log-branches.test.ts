import { describe, expect, spyOn, test } from "bun:test";
import * as cli from "@/cli";
import { runLog } from "@/commands/log";
import * as logger from "@/lib/logger";
import { captureExitCode, captureJsonOutput, withMutedTerminalLogs } from "../helpers/capture";

describe("runLog guarded branches", () => {
  test("exits with code 1 when log command definition is unavailable", async () => {
    const commandDefSpy = spyOn(cli, "getCommandDef").mockImplementation(() => undefined);
    try {
      const exitCode = await withMutedTerminalLogs(() =>
        captureExitCode(async () => {
          await runLog([]);
        })
      );

      expect(exitCode).toBe(1);
    } finally {
      commandDefSpy.mockRestore();
    }
  });

  test("prints empty global JSON when no global log sessions are discovered", async () => {
    const listLogSessionsSpy = spyOn(logger, "listLogSessions").mockImplementation(async () => []);
    try {
      const outputs = await captureJsonOutput(async () => {
        await runLog(["--json", "--global"]);
      });

      expect(outputs).toEqual([{ sessions: [] }]);
    } finally {
      listLogSessionsSpy.mockRestore();
    }
  });
});
