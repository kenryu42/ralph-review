/**
 * Agent module exports
 * Re-exports from submodules for clean import paths
 */

// Core agent functionality
export { AGENTS, isAgentAvailable, runAgent } from "./agents";

// Claude stream parsing (used by engine.ts)
export { extractClaudeResult, formatClaudeReviewForFixer } from "./claude-stream";
