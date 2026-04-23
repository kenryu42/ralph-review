import { useEffect } from "react";

// Escape hatch for one-time syncs with external systems on mount.
export function useMountEffect(effect: () => undefined | (() => void)) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only sync
  useEffect(effect, []);
}
