import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement, useState } from "react";
import {
  type ScrollMetrics,
  useScrollMetrics,
} from "@/lib/tui/sessions/detail/session-detail-scroll";
import { actAndRender } from "../../helpers/tui";

describe("useScrollMetrics", () => {
  let setup: Awaited<ReturnType<typeof testRender>> | null = null;

  afterEach(async () => {
    if (setup) {
      await act(async () => {
        setup?.renderer.destroy();
      });
      setup = null;
    }
    mock.restore();
  });

  test("registers one mount interval, ignores polls while unfocused, samples when focused, and clears on unmount", async () => {
    const intervalCallbacks: Array<() => void> = [];
    const clearedTimers: number[] = [];
    const scrollbox = {
      scrollTop: 3,
      viewport: { height: 4 },
      scrollHeight: 12,
    } as unknown as ScrollBoxRenderable;
    let latestMetrics: ScrollMetrics | null = null;
    let setFocused!: (value: boolean) => void;

    spyOn(globalThis, "setInterval").mockImplementation(
      (...args: Parameters<typeof setInterval>) => {
        const [handler] = args;
        intervalCallbacks.push(handler as () => void);
        return intervalCallbacks.length as unknown as ReturnType<typeof setInterval>;
      }
    );
    spyOn(globalThis, "clearInterval").mockImplementation((timer) => {
      clearedTimers.push(timer as number);
    });

    function Probe() {
      const [focused, updateFocused] = useState(false);
      setFocused = updateFocused;
      latestMetrics = useScrollMetrics({ current: scrollbox }, focused);
      return createElement("text", null, "probe");
    }

    function expectLatestMetrics(expected: ScrollMetrics) {
      if (!latestMetrics) {
        throw new Error("expected hook metrics to be available");
      }

      expect(latestMetrics).toEqual(expected);
    }

    async function updateProbe(update: () => void) {
      await actAndRender(setup, update);
    }

    setup = await testRender(createElement(Probe), { width: 20, height: 4 });
    await act(async () => {
      await setup?.renderOnce();
    });

    expect(intervalCallbacks).toHaveLength(1);
    expectLatestMetrics({
      scrollTop: 0,
      viewportHeight: 1,
      scrollHeight: 1,
    });

    await updateProbe(() => intervalCallbacks[0]?.());
    expectLatestMetrics({
      scrollTop: 0,
      viewportHeight: 1,
      scrollHeight: 1,
    });

    await updateProbe(() => setFocused(true));
    expect(intervalCallbacks).toHaveLength(1);

    await updateProbe(() => intervalCallbacks[0]?.());
    expectLatestMetrics({
      scrollTop: 3,
      viewportHeight: 4,
      scrollHeight: 12,
    });

    scrollbox.scrollTop = 8;

    await updateProbe(() => setFocused(false));

    await updateProbe(() => intervalCallbacks[0]?.());
    expectLatestMetrics({
      scrollTop: 3,
      viewportHeight: 4,
      scrollHeight: 12,
    });

    await act(async () => {
      setup?.renderer.destroy();
    });
    setup = null;

    expect(clearedTimers).toEqual([1]);
  });
});
