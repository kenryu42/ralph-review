import { describe, expect, test } from "bun:test";
import { parseFixCommandOptions } from "@/commands/fix";

describe("fix command", () => {
  test("parses repeated priority flags as a union", () => {
    const options = parseFixCommandOptions([
      "--session",
      "session-123",
      "--priority",
      "P0",
      "--priority",
      "P2",
    ]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        priorities: ["P0", "P2"],
      },
    });
  });

  test("parses repeated id flags as a union", () => {
    const options = parseFixCommandOptions([
      "--session",
      "session-123",
      "--id",
      "F001",
      "--id",
      "F003",
    ]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        ids: ["F001", "F003"],
      },
    });
  });

  test("parses all selector mode", () => {
    const options = parseFixCommandOptions(["--session", "session-123", "--all"]);

    expect(options).toEqual({
      sessionId: "session-123",
      selector: {
        all: true,
      },
    });
  });

  test("requires a session id", () => {
    expect(() => parseFixCommandOptions(["--all"])).toThrow(
      "fix: missing required argument <session>"
    );
  });
});
