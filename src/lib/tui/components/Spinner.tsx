import { useEffect, useState } from "react";
import { TUI_COLORS } from "@/lib/tui/colors";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
const FRAME_INTERVAL_MS = 80;

interface SpinnerProps {
  color?: string;
}

export function Spinner({ color = TUI_COLORS.status.success }: SpinnerProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return <text fg={color}>{SPINNER_FRAMES[frameIndex]}</text>;
}
