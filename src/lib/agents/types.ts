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

/**
 * Type definitions for Droid's streaming JSONL output format
 * Used when running Droid with --output-format stream-json
 */

/**
 * Top-level Droid event union - discriminated by 'type' field
 */
export type DroidStreamEvent =
  | DroidSystemInitEvent
  | DroidMessageEvent
  | DroidToolCallEvent
  | DroidToolResultEvent
  | DroidCompletionEvent;

/**
 * Droid system initialization event
 */
export interface DroidSystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
  reasoning_effort?: string;
}

/**
 * Droid message event - user or assistant messages
 */
export interface DroidMessageEvent {
  type: "message";
  role: "user" | "assistant";
  id: string;
  text: string;
  timestamp: number;
  session_id: string;
}

/**
 * Droid tool call event
 */
export interface DroidToolCallEvent {
  type: "tool_call";
  id: string;
  messageId: string;
  toolId: string;
  toolName: string;
  parameters: unknown;
  timestamp: number;
  session_id: string;
}

/**
 * Droid tool result event
 */
export interface DroidToolResultEvent {
  type: "tool_result";
  id: string;
  messageId: string;
  toolId: string;
  isError: boolean;
  value: string;
  timestamp?: number;
  session_id: string;
}

/**
 * Droid completion event - final result
 */
export interface DroidCompletionEvent {
  type: "completion";
  finalText: string;
  numTurns: number;
  durationMs: number;
  session_id: string;
  timestamp: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Type definitions for Gemini CLI's streaming JSONL output format
 * Used when running Gemini with --output-format stream-json
 *
 * NOTE: Gemini streams assistant messages as deltas that need to be concatenated
 */

/**
 * Top-level Gemini event union - discriminated by 'type' field
 */
export type GeminiStreamEvent =
  | GeminiInitEvent
  | GeminiMessageEvent
  | GeminiToolUseEvent
  | GeminiToolResultEvent
  | GeminiResultEvent;

/**
 * Gemini initialization event
 */
export interface GeminiInitEvent {
  type: "init";
  timestamp: string;
  session_id: string;
  model: string;
}

/**
 * Gemini message event - user or assistant messages
 * Assistant messages with delta: true are streaming chunks that need concatenation
 */
export interface GeminiMessageEvent {
  type: "message";
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  delta?: boolean;
}

/**
 * Gemini tool use event
 */
export interface GeminiToolUseEvent {
  type: "tool_use";
  timestamp: string;
  tool_name: string;
  tool_id: string;
  parameters: unknown;
}

/**
 * Gemini tool result event
 */
export interface GeminiToolResultEvent {
  type: "tool_result";
  timestamp: string;
  tool_id: string;
  status: "success" | "error" | string;
  output: string;
}

/**
 * Gemini result event - final stats
 */
export interface GeminiResultEvent {
  type: "result";
  timestamp: string;
  status: "success" | "error" | string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    input?: number;
    duration_ms?: number;
    tool_calls?: number;
  };
}

/**
 * Type definitions for Codex CLI's streaming JSONL output format
 * Used when running Codex with --output-format stream-json
 */

/**
 * Top-level Codex event union - discriminated by 'type' field
 */
export type CodexStreamEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnCompletedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent;

/**
 * Codex thread started event - first event in stream
 */
export interface CodexThreadStartedEvent {
  type: "thread.started";
  thread_id: string;
}

/**
 * Codex turn started event
 */
export interface CodexTurnStartedEvent {
  type: "turn.started";
}

/**
 * Codex turn completed event with usage stats
 */
export interface CodexTurnCompletedEvent {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Codex item started event
 */
export interface CodexItemStartedEvent {
  type: "item.started";
  item: CodexItem;
}

/**
 * Codex item completed event
 */
export interface CodexItemCompletedEvent {
  type: "item.completed";
  item: CodexItem;
}

/**
 * Codex item union - discriminated by 'type' field
 */
type CodexItem = CodexReasoningItem | CodexCommandExecutionItem | CodexAgentMessageItem;

/**
 * Codex reasoning item (thinking)
 */
export interface CodexReasoningItem {
  type: "reasoning";
  id: string;
  text: string;
}

/**
 * Codex command execution item (tool use)
 */
export interface CodexCommandExecutionItem {
  type: "command_execution";
  id: string;
  command: string;
  aggregated_output: string;
  exit_code: number | null;
  status: "in_progress" | "completed";
}

/**
 * Codex agent message item (final response)
 */
export interface CodexAgentMessageItem {
  type: "agent_message";
  id: string;
  text: string;
}
