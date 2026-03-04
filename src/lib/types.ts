export type MessageRole = "user" | "assistant";

// Simplified local content block — avoids SDK version churn on required fields
export type LocalContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: MessageRole;
  content: string | LocalContentBlock[];
  /** UUID v4 for this message */
  id?: string;
  /** ID of the preceding message (for threading) */
  parentId?: string;
  /** Estimated cost of this message in USD */
  costUSD?: number;
  /** Duration of the AI response in milliseconds */
  durationMs?: number;
  /** Token usage for this message */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /** Turn events (tool calls, results, thinking) for rendering history */
  events?: TurnEvent[];
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export type AgentStatus = "idle" | "thinking" | "tool_use" | "responding" | "compacting";

export interface TurnEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  name?: string;
  input?: unknown;
  result?: string;
  is_error?: boolean;
  injectionWarning?: string;
}
