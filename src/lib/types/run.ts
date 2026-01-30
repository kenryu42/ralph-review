/**
 * Runtime state types
 */

/**
 * Current state of a running review session
 */
export interface RunState {
  sessionName: string;
  startTime: number; // Unix timestamp
  iteration: number;
  status: "running" | "stopped" | "completed" | "failed";
  lastOutput?: string;
}

/**
 * Result of a single iteration (either review or fix)
 */
export interface IterationResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number; // in milliseconds
}

/**
 * Error details for a failed iteration
 */
export interface IterationError {
  phase: "reviewer" | "fixer";
  message: string;
  exitCode?: number;
}
