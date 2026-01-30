/**
 * Agent module exports
 * Re-exports from submodules for clean import paths
 */

// Core agent functionality
export { AGENTS, isAgentAvailable, runAgent } from "./agents";

// Claude stream parsing (used by engine.ts)
export { extractClaudeResult } from "./claude-stream";
// Codex stream parsing (used by engine.ts)
export { extractCodexResult } from "./codex-stream";
// Droid stream parsing (used by engine.ts)
export { extractDroidResult } from "./droid-stream";
// Gemini stream parsing (used by engine.ts)
export { extractGeminiResult } from "./gemini-stream";
