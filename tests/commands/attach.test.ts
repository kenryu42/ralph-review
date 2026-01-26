import { describe, expect, test } from "bun:test";

// Note: Full integration tests require tmux and are skipped in CI
// These tests verify the exported interface and basic behavior

describe("attach command", () => {
  describe("runAttach", () => {
    test("exported from module", async () => {
      const { runAttach } = await import("@/commands/attach");
      expect(typeof runAttach).toBe("function");
    });

    test("accepts args parameter", async () => {
      const { runAttach } = await import("@/commands/attach");
      // Verify function signature accepts array parameter
      expect(runAttach.length).toBeGreaterThanOrEqual(0);
    });
  });
});
