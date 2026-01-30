export interface RunState {
  sessionName: string;
  startTime: number; // Unix timestamp
  iteration: number;
  status: "running" | "stopped" | "completed" | "failed";
  lastOutput?: string;
}

/** Outcome of one review-fix cycle iteration */
export interface IterationResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number; // in milliseconds
}

export interface IterationError {
  phase: "reviewer" | "fixer";
  message: string;
  exitCode?: number;
}
