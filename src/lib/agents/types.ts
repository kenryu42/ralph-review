export type ClaudeStreamEvent = SystemInitEvent | AssistantEvent | UserEvent | ResultEvent;

export interface SystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
}

export interface AssistantEvent {
  type: "assistant";
  session_id: string;
  message: AssistantMessage;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  stop_reason: string | null;
}

export type AssistantContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface UserEvent {
  type: "user";
  session_id: string;
  message: UserMessage;
  tool_use_result?: ToolUseResult;
}

export interface UserMessage {
  role: "user";
  content: UserContentBlock[];
}

type UserContentBlock = UserTextBlock | ToolResultBlock;

interface UserTextBlock {
  type: "text";
  text: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolUseResult {
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

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

export type DroidStreamEvent =
  | DroidSystemInitEvent
  | DroidMessageEvent
  | DroidToolCallEvent
  | DroidToolResultEvent
  | DroidCompletionEvent;

export interface DroidSystemInitEvent {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
  reasoning_effort?: string;
}

export interface DroidMessageEvent {
  type: "message";
  role: "user" | "assistant";
  id: string;
  text: string;
  timestamp: number;
  session_id: string;
}

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

export type GeminiStreamEvent =
  | GeminiInitEvent
  | GeminiMessageEvent
  | GeminiToolUseEvent
  | GeminiToolResultEvent
  | GeminiResultEvent;

export interface GeminiInitEvent {
  type: "init";
  timestamp: string;
  session_id: string;
  model: string;
}

export interface GeminiMessageEvent {
  type: "message";
  timestamp: string;
  role: "user" | "assistant";
  content: string;
  delta?: boolean;
}

export interface GeminiToolUseEvent {
  type: "tool_use";
  timestamp: string;
  tool_name: string;
  tool_id: string;
  parameters: unknown;
}

export interface GeminiToolResultEvent {
  type: "tool_result";
  timestamp: string;
  tool_id: string;
  status: "success" | "error" | string;
  output: string;
}

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

export type CodexStreamEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnCompletedEvent
  | CodexItemStartedEvent
  | CodexItemCompletedEvent;

export interface CodexThreadStartedEvent {
  type: "thread.started";
  thread_id: string;
}

export interface CodexTurnStartedEvent {
  type: "turn.started";
}

export interface CodexTurnCompletedEvent {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

export interface CodexItemStartedEvent {
  type: "item.started";
  item: CodexItem;
}

export interface CodexItemCompletedEvent {
  type: "item.completed";
  item: CodexItem;
}

type CodexItem = CodexReasoningItem | CodexCommandExecutionItem | CodexAgentMessageItem;

export interface CodexReasoningItem {
  type: "reasoning";
  id: string;
  text: string;
}

export interface CodexCommandExecutionItem {
  type: "command_execution";
  id: string;
  command: string;
  aggregated_output: string;
  exit_code: number | null;
  status: "in_progress" | "completed";
}

export interface CodexAgentMessageItem {
  type: "agent_message";
  id: string;
  text: string;
}
