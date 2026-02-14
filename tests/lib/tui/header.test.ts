import { describe, expect, test } from "bun:test";
import { getHeaderAgentDisplays } from "@/lib/tui/components/Header";
import { createConfig } from "../../helpers/diagnostics";

describe("getHeaderAgentDisplays", () => {
  test("returns unknown defaults when config is missing", () => {
    const displays = getHeaderAgentDisplays(null);

    expect(displays.reviewerDisplay).toBe("Unknown (Default, Default)");
    expect(displays.fixerDisplay).toBe("Unknown (Default, Default)");
    expect(displays.simplifierDisplay).toBeUndefined();
  });

  test("includes simplifier when run.simplifier is enabled", () => {
    const config = {
      ...createConfig(),
      run: { simplifier: true },
    };

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toContain("Droid");
    expect(displays.simplifierDisplay).toContain("GPT-5.2 Codex");
  });

  test("falls back to reviewer when simplifier is enabled but code-simplifier is missing", () => {
    const config = {
      ...createConfig(),
      run: { simplifier: true },
    };
    delete config["code-simplifier"];

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toContain("Codex");
    expect(displays.simplifierDisplay).toContain("GPT-5.3 Codex");
  });

  test("omits simplifier when run.simplifier is disabled", () => {
    const config = {
      ...createConfig(),
      run: { simplifier: false },
    };

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toBeUndefined();
  });
});
