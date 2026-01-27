/**
 * Type definitions for Claude's streaming JSONL output format
 * Used when running Claude with --output-format stream-json
 */

/**
 * Top-level event union - discriminated by 'type' field
 */
export type ClaudeStreamEvent = SystemInitEvent | AssistantEvent | UserEvent | ResultEvent;

/**
 * System initialization event - first event in stream
 */
export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
}

/**
 * Assistant message event - contains content blocks
 */
export interface AssistantEvent {
  type: "assistant";
  session_id: string;
  message: AssistantMessage;
}

/**
 * Assistant message structure
 */
export interface AssistantMessage {
  id: string;
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  stop_reason: string | null;
}

/**
 * Content block union - discriminated by 'type' field
 */
export type AssistantContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

/**
 * Thinking block - Claude's internal reasoning
 */
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

/**
 * Text block - visible text output
 */
export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * Tool use block - tool invocation
 */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

/**
 * User event - typically tool results
 */
export interface UserEvent {
  type: "user";
  session_id: string;
  message: UserMessage;
  tool_use_result?: ToolUseResult;
}

/**
 * User message structure
 */
export interface UserMessage {
  role: "user";
  content: UserContentBlock[];
}

/**
 * User content block union
 */
type UserContentBlock = UserTextBlock | ToolResultBlock;

/**
 * User text block
 */
interface UserTextBlock {
  type: "text";
  text: string;
}

/**
 * Tool result block
 */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Tool use result - structured result data
 */
export interface ToolUseResult {
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

/**
 * Final result event - last event in stream
 */
export interface ResultEvent {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  session_id: string;
  duration_ms: number;
  num_turns: number;
  total_cost_usd?: number;
}
