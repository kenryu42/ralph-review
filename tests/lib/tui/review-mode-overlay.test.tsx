import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import { buildReviewRunArgs, ReviewModeOverlay } from "@/lib/tui/dashboard/ReviewModeOverlay";
import type { DefaultReview } from "@/lib/types";

describe("buildReviewRunArgs", () => {
  test("returns the uncommitted flag", () => {
    expect(buildReviewRunArgs("uncommitted")).toEqual(["--uncommitted"]);
  });

  test("returns the trimmed base branch", () => {
    expect(buildReviewRunArgs("base", "\n  origin/main  \n")).toEqual(["--base", "origin/main"]);
  });

  test("rejects multiline base branch input", () => {
    expect(() => buildReviewRunArgs("base", "main\nfeature")).toThrow(
      "Base branch must be a single line."
    );
  });

  test("returns the trimmed target commit", () => {
    expect(buildReviewRunArgs("commit", "  abc1234  ")).toEqual(["--commit", "abc1234"]);
  });

  test("preserves multiline custom instructions", () => {
    expect(buildReviewRunArgs("custom", "line 1\nline 2")).toEqual(["--custom", "line 1\nline 2"]);
  });

  test("rejects blank custom instructions", () => {
    expect(() => buildReviewRunArgs("custom", "   ")).toThrow(
      "Custom review instructions are required."
    );
  });
});

describe("ReviewModeOverlay", () => {
  let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (testSetup) {
      await act(async () => {
        testSetup?.renderer.destroy();
      });
      testSetup = null;
    }
  });

  async function renderOverlay(
    props: {
      defaultReview?: DefaultReview;
      onClose?: () => void;
      onSubmit?: (args: string[]) => void;
    } = {}
  ) {
    const defaultProps: Parameters<typeof ReviewModeOverlay>[0] = {
      defaultReview: { type: "uncommitted" },
      projectPath: "/tmp/test-project",
      onClose: () => {},
      onSubmit: () => {},
      ...props,
    };

    testSetup = await testRender(createElement(ReviewModeOverlay, defaultProps), {
      width: 100,
      height: 30,
    });

    await act(async () => {
      await testSetup?.renderOnce();
    });

    return testSetup;
  }

  async function emitKey(setup: Awaited<ReturnType<typeof testRender>>, name: string) {
    const sequenceMap: Record<string, string> = {
      down: "\x1B[B",
      up: "\x1B[A",
      escape: "\x1B",
      return: "\r",
      q: "q",
      j: "j",
      k: "k",
    };

    await act(async () => {
      setup.renderer.keyInput.emit(
        "keypress",
        new KeyEvent({
          name,
          sequence: sequenceMap[name] ?? name,
          ctrl: false,
          shift: false,
          meta: false,
          option: false,
          eventType: "press",
          repeated: false,
          source: "raw",
          number: false,
          raw: sequenceMap[name] ?? name,
        })
      );
      await setup.renderOnce();
    });
  }

  test("submits uncommitted changes immediately by default", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "return");

    expect(submitted).toEqual([["--uncommitted"]]);
  });

  test("highlights the base branch option when defaultReview is base", async () => {
    const setup = await renderOverlay({
      defaultReview: { type: "base", branch: "main" },
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("▶ Against base branch");
  });

  test("supports j and arrow navigation before confirming", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "j");
    await emitKey(setup, "return");

    await emitKey(setup, "escape");

    await emitKey(setup, "down");
    await emitKey(setup, "return");

    await act(async () => {
      await setup.mockInput.typeText("abc1234");
      await setup.renderOnce();
    });

    await emitKey(setup, "return");

    expect(submitted).toEqual([["--commit", "abc1234"]]);
  });

  test("submits custom instructions with enter", async () => {
    const submitted: string[][] = [];
    const setup = await renderOverlay({
      onSubmit: (args) => {
        submitted.push(args);
      },
    });

    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "down");
    await emitKey(setup, "return");

    await act(async () => {
      await setup.mockInput.typeText("check security");
      await setup.renderOnce();
    });
    await emitKey(setup, "return");

    expect(submitted).toEqual([["--custom", "check security"]]);
  });

  test("closes the picker when q is pressed", async () => {
    let closeCount = 0;
    const setup = await renderOverlay({
      onClose: () => {
        closeCount += 1;
      },
    });

    await emitKey(setup, "q");

    expect(closeCount).toBe(1);
  });
});
