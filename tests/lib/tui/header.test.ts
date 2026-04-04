import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { SessionState } from "@/lib/session-state";
import { getHeaderAgentDisplays, Header } from "@/lib/tui/components/Header";
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
      run: { simplifier: true, interactive: true },
    };

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toContain("Droid");
    expect(displays.simplifierDisplay).toContain("GPT-5.2-Codex");
  });

  test("falls back to reviewer when simplifier is enabled but code-simplifier is missing", () => {
    const config = {
      ...createConfig(),
      run: { simplifier: true, interactive: true },
    };
    delete config["code-simplifier"];

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toContain("Codex");
    expect(displays.simplifierDisplay).toContain("GPT-5.3 Codex");
  });

  test("omits simplifier when run.simplifier is disabled", () => {
    const config = {
      ...createConfig(),
      run: { simplifier: false, interactive: true },
    };

    const displays = getHeaderAgentDisplays(config);

    expect(displays.simplifierDisplay).toBeUndefined();
  });
});

describe("Header", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  function createSession(): SessionState {
    return {
      schemaVersion: 2,
      sessionId: "session-1",
      sessionName: "rr-test-123",
      startTime: Date.now(),
      lastHeartbeat: Date.now(),
      pid: process.pid,
      projectPath: "/test/project",
      branch: "main",
      state: "running",
      mode: "background",
    };
  }

  async function renderFrame(props: Partial<Parameters<typeof Header>[0]> = {}): Promise<string> {
    const defaultProps: Parameters<typeof Header>[0] = {
      projectName: "ralph-review",
      elapsed: 59_000,
      session: null,
      projectPath: "/tmp/ralph-review",
      config: createConfig(),
    };

    testSetup = await testRender(createElement(Header, { ...defaultProps, ...props }), {
      width: 200,
      height: 20,
    });
    await act(async () => {
      await testSetup?.renderOnce();
    });
    return testSetup.captureCharFrame();
  }

  test("renders elapsed duration in seconds when under one minute", async () => {
    const frame = await renderFrame({ elapsed: 59_000 });
    expect(frame).toContain("Elapsed: 59s");
  });

  test("renders elapsed duration in minutes and seconds when over one minute", async () => {
    const frame = await renderFrame({ elapsed: 185_000 });
    expect(frame).toContain("Elapsed: 3m 5s");
  });

  test("renders elapsed duration in hours, minutes, and seconds when over one hour", async () => {
    const frame = await renderFrame({ elapsed: 7_384_000 });
    expect(frame).toContain("Elapsed: 2h 3m 4s");
  });

  test("renders inactive icon when session is missing", async () => {
    const frame = await renderFrame({ session: null });
    expect(frame).toContain("○");
  });

  test("renders active icon when session is present", async () => {
    const frame = await renderFrame({ session: createSession() });
    expect(frame).toContain("●");
  });

  test("renders branch when branch is provided", async () => {
    const frame = await renderFrame({ branch: "feature/header-tests" });
    expect(frame).toContain("[feature/header-tests]");
  });

  test("renders uncommitted default review on the last line", async () => {
    const frame = await renderFrame({
      config: {
        ...createConfig(),
        defaultReview: { type: "uncommitted" },
      },
    });

    expect(frame).toContain("Default review: uncommitted changes");
  });

  test("renders base-branch default review on the last line", async () => {
    const frame = await renderFrame({
      config: {
        ...createConfig(),
        defaultReview: { type: "base", branch: "main" },
      },
    });

    expect(frame).toContain("Default review: base (main)");
  });

  test("omits branch when branch is not provided", async () => {
    const frame = await renderFrame({ branch: undefined });
    expect(frame).not.toContain("[feature/header-tests]");
  });

  test("omits default review when config is missing", async () => {
    const frame = await renderFrame({ config: null });
    expect(frame).not.toContain("Default review:");
  });

  test("keeps the project path aligned when config is missing", async () => {
    const frame = await renderFrame({ config: null });

    expect(frame).toContain("/tmp/ralph-review");
  });

  test("replaces home directory prefix with tilde when path is under HOME", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/Users/tester";

    try {
      const frame = await renderFrame({
        projectPath: "/Users/tester/work/ralph-review",
      });
      expect(frame).toContain("~/work/ralph-review");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  test("keeps absolute path when path is outside HOME", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/Users/tester";

    try {
      const frame = await renderFrame({
        projectPath: "/var/tmp/ralph-review",
      });
      expect(frame).toContain("/var/tmp/ralph-review");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  test("renders simplifier display when simplifier is enabled", async () => {
    const frame = await renderFrame({
      config: {
        ...createConfig(),
        run: { simplifier: true, interactive: true },
      },
    });
    expect(frame).toContain("S:");
    expect(frame).toContain("Droid");
  });

  test("does not render simplifier display when simplifier is disabled", async () => {
    const frame = await renderFrame({
      config: {
        ...createConfig(),
        run: { simplifier: false, interactive: true },
      },
    });
    // Only R: and F: should appear, not S:
    expect(frame).toContain("R:");
    expect(frame).toContain("F:");
    // We can't easily check for absence of "S:" since "S" appears in other text,
    // but the simplifier display line should not be present
    expect(frame).not.toContain("S: Droid");
  });
});
