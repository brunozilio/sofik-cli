import type { Message, ToolDefinition, ToolResult } from "../types.ts";

export interface StreamParams {
  model: string;
  messages: Message[];
  tools: ToolDefinition[];
  onToolUse: (name: string, input: unknown) => Promise<void>;
  onToolResult: (result: ToolResult) => void;
  signal?: AbortSignal;
  /** Override the system prompt. If omitted, providers call buildSystemPrompt() internally. */
  systemOverride?: string;
}

export interface LLMProvider {
  readonly name: string;
  supportsModel(model: string): boolean;
  stream(params: StreamParams): AsyncGenerator<string>;
}
