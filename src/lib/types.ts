export type MessageRole = "user" | "assistant";

// Simplified local content block — avoids SDK version churn on required fields
export type LocalContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: MessageRole;
  content: string | LocalContentBlock[];
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
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: unknown;
  result?: string;
  is_error?: boolean;
  injectionWarning?: string;
}
