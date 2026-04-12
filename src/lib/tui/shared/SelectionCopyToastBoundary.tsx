import type { Selection } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as clipboard from "@/lib/tui/shared/clipboard";
import { TUI_COLORS } from "@/lib/tui/shared/colors";

const SUCCESS_TOAST_DURATION_MS = 2_000;
const ERROR_TOAST_DURATION_MS = 4_000;

type ToastTone = "success" | "error";

interface ToastState {
  message: string;
  tone: ToastTone;
}

function CopyToast({ toast }: { toast: ToastState }) {
  const { width: terminalWidth } = useTerminalDimensions();
  const toastWidth = Math.max(24, Math.min(terminalWidth - 2, toast.message.length + 6));
  const borderColor =
    toast.tone === "success" ? TUI_COLORS.status.success : TUI_COLORS.status.error;

  return (
    <box
      position="absolute"
      top={1}
      right={1}
      width={toastWidth}
      zIndex={10}
      border
      borderStyle="rounded"
      borderColor={borderColor}
      backgroundColor="#111827"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={TUI_COLORS.text.primary} wrapMode="none" selectable={false}>
        {toast.message}
      </text>
    </box>
  );
}

export function SelectionCopyToastBoundary({ children }: { children: ReactNode }) {
  const renderer = useRenderer();
  const [toast, setToast] = useState<ToastState | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((nextToast: ToastState, durationMs: number) => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }

    setToast(nextToast);

    const dismissTimer = setTimeout(() => {
      setToast(null);
      dismissTimerRef.current = null;
    }, durationMs);

    dismissTimer.unref?.();
    dismissTimerRef.current = dismissTimer;
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const handleSelection = async (selection: Selection) => {
      const selectedText = selection.getSelectedText();
      if (selectedText.length === 0) {
        return;
      }

      try {
        await clipboard.copyToClipboard(selectedText);
        if (!mounted) {
          return;
        }

        renderer.clearSelection();
        showToast(
          {
            message: "Copied to clipboard",
            tone: "success",
          },
          SUCCESS_TOAST_DURATION_MS
        );
      } catch {
        if (!mounted) {
          return;
        }

        showToast(
          {
            message: "Failed to copy to clipboard",
            tone: "error",
          },
          ERROR_TOAST_DURATION_MS
        );
      }
    };

    renderer.on("selection", handleSelection);

    return () => {
      mounted = false;
      renderer.off("selection", handleSelection);
    };
  }, [renderer, showToast]);

  return (
    <box width="100%" height="100%">
      {children}
      {toast && <CopyToast toast={toast} />}
    </box>
  );
}
