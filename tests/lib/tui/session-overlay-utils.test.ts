import { describe, expect, test } from "bun:test";
import type { LogSession } from "@/lib/logger";
import {
  buildSessionOverlayOptions,
  resolveSessionOverlayKeyAction,
} from "@/lib/tui/sessions/history/session-overlay-utils";

function buildLogSession(overrides: Partial<LogSession> = {}): LogSession {
  return {
    path: "/tmp/logs/2026-04-10_main.jsonl",
    name: "2026-04-10_main.jsonl",
    projectName: "project-a",
    timestamp: new Date("2026-04-10T01:00:00.000Z").getTime(),
    ...overrides,
  };
}

describe("buildSessionOverlayOptions", () => {
  test("builds select options and slots for sessions", () => {
    const sessions: LogSession[] = [
      buildLogSession({
        path: "/tmp/logs/a-1.jsonl",
        name: "a-1.jsonl",
        projectName: "project-a",
      }),
      buildLogSession({
        path: "/tmp/logs/b-1.jsonl",
        name: "b-1.jsonl",
        projectName: "project-b",
      }),
      buildLogSession({
        path: "/tmp/logs/a-2.jsonl",
        name: "a-2.jsonl",
        projectName: "project-a",
      }),
    ];

    const result = buildSessionOverlayOptions(sessions);

    expect(result.selectOptions).toHaveLength(3);
    expect(result.sessionSlots.map((slot) => slot?.path)).toEqual([
      "/tmp/logs/a-1.jsonl",
      "/tmp/logs/a-2.jsonl",
      "/tmp/logs/b-1.jsonl",
    ]);
    expect(result.selectOptions[0]?.name).toContain("a-1");
    expect(result.selectOptions[1]?.name).toContain("a-2");
    expect(result.selectOptions[2]?.name).toContain("b-1");
  });
});

describe("resolveSessionOverlayKeyAction", () => {
  test("handles delete confirm keys before any other interaction", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "escape",
        showHelp: false,
        showDeleteConfirm: true,
        hasSelectedSession: true,
      })
    ).toBe("close-delete-confirm");

    expect(
      resolveSessionOverlayKeyAction({
        keyName: "y",
        showHelp: false,
        showDeleteConfirm: true,
        hasSelectedSession: true,
      })
    ).toBe("confirm-delete");
  });

  test("toggles help and allows closing overlay when no modal is open", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "h",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
      })
    ).toBe("toggle-help");

    expect(
      resolveSessionOverlayKeyAction({
        keyName: "q",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
      })
    ).toBe("close-overlay");
  });

  test("blocks delete when no session is selected", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "d",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: false,
      })
    ).toBe("none");
  });

  test("does not open fix findings from the history overlay", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "f",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
      })
    ).toBe("none");
  });

  test("Enter focuses detail only from the list pane in narrow mode", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "return",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
        isNarrow: true,
        focusedPane: "list",
      })
    ).toBe("focus-detail");

    expect(
      resolveSessionOverlayKeyAction({
        keyName: "enter",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
        isNarrow: true,
        focusedPane: "list",
      })
    ).toBe("focus-detail");
  });

  test("Enter does nothing from the detail pane in narrow mode", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "return",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
        isNarrow: true,
        focusedPane: "detail",
      })
    ).toBe("none");
  });

  test("Enter does nothing in wide mode regardless of focus", () => {
    expect(
      resolveSessionOverlayKeyAction({
        keyName: "return",
        showHelp: false,
        showDeleteConfirm: false,
        hasSelectedSession: true,
        isNarrow: false,
        focusedPane: "list",
      })
    ).toBe("none");
  });
});
