import type { Selection } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import * as clipboard from "@/lib/tui/shared/clipboard";
import { TUI_COLORS } from "@/lib/tui/shared/colors";
import { useMountEffect } from "@/lib/tui/shared/use-mount-effect";

const SUCCESS_TOAST_DURATION_MS = 2_000;
const ERROR_TOAST_DURATION_MS = 4_000;

type ToastTone = "success" | "error";

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface CopyTextOptions {
  successMessage?: string;
  errorMessage?: string;
}

interface SelectionCopyToastContextValue {
  copyText: (text: string, options?: CopyTextOptions) => Promise<boolean>;
}

const SelectionCopyToastContext = createContext<SelectionCopyToastContextValue | null>(null);

export function useSelectionCopyToast(): SelectionCopyToastContextValue {
  const context = useContext(SelectionCopyToastContext);
  if (!context) {
    throw new Error("useSelectionCopyToast must be used within SelectionCopyToastBoundary");
  }

  return context;
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
  const mountedRef = useRef(true);

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

  const copyText = useCallback(
    async (text: string, options: CopyTextOptions = {}) => {
      try {
        await clipboard.copyToClipboard(text);
        if (!mountedRef.current) {
          return false;
        }

        showToast(
          {
            message: options.successMessage ?? "Copied to clipboard",
            tone: "success",
          },
          SUCCESS_TOAST_DURATION_MS
        );
        return true;
      } catch {
        if (!mountedRef.current) {
          return false;
        }

        showToast(
          {
            message: options.errorMessage ?? "Failed to copy to clipboard",
            tone: "error",
          },
          ERROR_TOAST_DURATION_MS
        );
        return false;
      }
    },
    [showToast]
  );

  useMountEffect(() => {
    return () => {
      mountedRef.current = false;
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  });

  useMountEffect(() => {
    const handleSelection = async (selection: Selection) => {
      const selectedText = selection.getSelectedText();
      if (selectedText.length === 0) {
        return;
      }

      const copied = await copyText(selectedText);
      if (copied && mountedRef.current) {
        renderer.clearSelection();
      }
    };

    renderer.on("selection", handleSelection);

    return () => {
      renderer.off("selection", handleSelection);
    };
  });

  return (
    <SelectionCopyToastContext.Provider value={{ copyText }}>
      <box width="100%" height="100%">
        {children}
        {toast && <CopyToast toast={toast} />}
      </box>
    </SelectionCopyToastContext.Provider>
  );
}
