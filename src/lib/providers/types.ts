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
  /** Stop after this many agentic turns (LLM→tool→LLM cycles). Unlimited if omitted. */
  maxTurns?: number;
  /** Budget tokens for extended thinking (enables thinking mode). */
  thinkingBudget?: number;
  /** Called with actual input token count after each API response. */
  onUsageUpdate?: (inputTokens: number) => void;
  /** Called when a thinking block is received. */
  onThinking?: (text: string) => void;
}

export interface LLMProvider {
  readonly name: string;
  supportsModel(model: string): boolean;
  stream(params: StreamParams): AsyncGenerator<string>;
}
