import { describe, expect, test } from "bun:test";
import { getCommandDef } from "@/cli";

describe("list command", () => {
  test("command definition exists", () => {
    const def = getCommandDef("list");
    expect(def).toBeDefined();
    expect(def?.name).toBe("list");
  });

  test("has ls alias", () => {
    const def = getCommandDef("list");
    expect(def?.aliases).toContain("ls");
  });

  test("has no options", () => {
    const def = getCommandDef("list");
    expect(def?.options).toBeUndefined();
  });

  test("has examples", () => {
    const def = getCommandDef("list");
    expect(def?.examples).toContain("rr list");
    expect(def?.examples).toContain("rr ls");
  });
});
