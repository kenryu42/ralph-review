import { describe, expect, test } from "bun:test";
import {
  resolveSelectedGroupPath,
  selectAdjacentGroupPath,
} from "@/lib/tui/dashboard/dashboard-group-selection";
import type { SessionGroupData } from "@/lib/tui/workspace/workspace-types";

function makeGroup(path: string, name = path.split("/").at(-1) ?? path): SessionGroupData {
  return {
    projectPath: path,
    projectName: name,
    isCurrentProject: false,
    sessions: [],
  };
}

describe("selectAdjacentGroupPath", () => {
  const groups = [makeGroup("/a"), makeGroup("/b"), makeGroup("/c")];

  test("moves to the previous group", () => {
    expect(selectAdjacentGroupPath(groups, "/b", "prev")).toBe("/a");
  });

  test("moves to the next group", () => {
    expect(selectAdjacentGroupPath(groups, "/b", "next")).toBe("/c");
  });

  test("clamps at the first group", () => {
    expect(selectAdjacentGroupPath(groups, "/a", "prev")).toBe("/a");
  });

  test("clamps at the last group", () => {
    expect(selectAdjacentGroupPath(groups, "/c", "next")).toBe("/c");
  });

  test("falls back to the first group when the current path is missing", () => {
    expect(selectAdjacentGroupPath(groups, "/missing", "next")).toBe("/a");
  });

  test("returns the current path when there are no groups", () => {
    expect(selectAdjacentGroupPath([], "/anything", "next")).toBe("/anything");
  });
});

describe("resolveSelectedGroupPath", () => {
  const groups = [makeGroup("/a"), makeGroup("/b")];

  test("keeps the preferred path when it exists in the groups", () => {
    expect(resolveSelectedGroupPath(groups, "/b", "/a")).toBe("/b");
  });

  test("falls back to the fallback path when the preferred path is missing", () => {
    expect(resolveSelectedGroupPath(groups, "/missing", "/a")).toBe("/a");
  });

  test("falls back to the first group when neither preferred nor fallback exist", () => {
    expect(resolveSelectedGroupPath(groups, "/missing", "/also-missing")).toBe("/a");
  });

  test("returns the fallback path when there are no groups", () => {
    expect(resolveSelectedGroupPath([], "/missing", "/fallback")).toBe("/fallback");
  });
});
