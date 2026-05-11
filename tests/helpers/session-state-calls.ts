export interface UpdateSessionStateCall {
  projectPath: string;
  sessionId: string;
  updates: Record<string, unknown>;
  expectedSessionId?: string;
}

export interface RemoveSessionStateCall {
  projectPath: string;
  sessionId: string;
  expectedSessionId?: string;
}
