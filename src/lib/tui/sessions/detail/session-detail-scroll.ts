import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useEffect, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

const SCROLL_METRICS_POLL_INTERVAL_MS = 100;

export interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
  scrollHeight: number;
}

export interface ScrollbarRow {
  char: string;
  color: string;
  key: string;
}

const DEFAULT_SCROLL_METRICS: ScrollMetrics = {
  scrollTop: 0,
  viewportHeight: 1,
  scrollHeight: 1,
};

export function useScrollMetrics(
  scrollboxRef: RefObject<ScrollBoxRenderable | null>,
  focused: boolean | undefined
): ScrollMetrics {
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>(DEFAULT_SCROLL_METRICS);

  useEffect(() => {
    if (!focused) {
      return;
    }

    const timer = setInterval(() => {
      const scrollbox = scrollboxRef.current;
      if (!scrollbox) {
        return;
      }

      const nextMetrics: ScrollMetrics = {
        scrollTop: scrollbox.scrollTop,
        viewportHeight: Math.max(1, scrollbox.viewport.height),
        scrollHeight: Math.max(1, scrollbox.scrollHeight),
      };

      setScrollMetrics((current) => {
        if (
          current.scrollTop === nextMetrics.scrollTop &&
          current.viewportHeight === nextMetrics.viewportHeight &&
          current.scrollHeight === nextMetrics.scrollHeight
        ) {
          return current;
        }

        return nextMetrics;
      });
    }, SCROLL_METRICS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [focused, scrollboxRef]);

  return scrollMetrics;
}

export function buildScrollBarRows(metrics: ScrollMetrics): ScrollbarRow[] {
  const viewportHeight = Math.max(1, metrics.viewportHeight);
  const totalHeight = Math.max(viewportHeight, metrics.scrollHeight);
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const thumbSize =
    maxScroll === 0
      ? viewportHeight
      : Math.max(1, Math.floor((viewportHeight * viewportHeight) / totalHeight));
  const maxThumbStart = Math.max(0, viewportHeight - thumbSize);
  const thumbStart =
    maxScroll === 0 ? 0 : Math.round((metrics.scrollTop / maxScroll) * maxThumbStart);

  return Array.from({ length: viewportHeight }, (_, index) => {
    const inThumb = index >= thumbStart && index < thumbStart + thumbSize;
    return {
      char: inThumb ? "█" : "│",
      color: inThumb ? TUI_COLORS.text.faint : TUI_COLORS.ui.border,
      key: `scrollbar-row-${index}`,
    };
  });
}
