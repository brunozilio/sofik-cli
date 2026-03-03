import type { Message, ToolDefinition, ToolResult } from "./types.ts";
import { COMPACTION_PROMPT } from "./systemPrompt.ts";
import { getModel } from "./models.ts";
import { streamResponse as providerStream } from "./providers/index.ts";
import { getSessionUsage, resetSessionUsage } from "./providers/anthropic.ts";
import { logger } from "./logger.ts";

export { getSessionUsage, resetSessionUsage };

// ── Model state ───────────────────────────────────────────────────────────────

let currentModel = "claude-opus-4-6";

export function setModel(model: string): void {
  const prev = currentModel;
  currentModel = model;
  if (prev !== model) {
    logger.app.info("Modelo alterado", { from: prev, to: model });
  }
}

export function getCurrentModel(): string {
  return currentModel;
}

// ── Cost estimation ───────────────────────────────────────────────────────────

export type { UsageStats } from "./providers/anthropic.ts";

const COST_PER_M: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6":   { input: 15,  output: 75 },
  "claude-sonnet-4-6": { input:  3,  output: 15 },
  "claude-haiku-4-5":  { input: 0.8, output:  4 },
};

export function estimateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number {
  const rates = COST_PER_M[model] ?? { input: 15, output: 75 };
  return (
    (usage.inputTokens  / 1_000_000) * rates.input +
    (usage.outputTokens / 1_000_000) * rates.output
  );
}

// ── Compaction ────────────────────────────────────────────────────────────────

export function shouldCompact(messages: Message[]): boolean {
  const model = getModel(currentModel);
  const approxTokens = Math.ceil(JSON.stringify(messages).length / 4);
  const threshold = model.contextWindow * 0.8;
  if (approxTokens > threshold) {
    logger.llm.warn("Contexto atingiu limiar de compactação", {
      model: currentModel,
      approxTokens,
      contextWindow: model.contextWindow,
      threshold: Math.round(threshold),
    });
    return true;
  }
  return false;
}

export async function compact(
  _client: unknown,
  messages: Message[]
): Promise<Message[]> {
  logger.llm.info("Compactação de contexto iniciada", { messageCount: messages.length, model: currentModel });
  const start = Date.now();

  const compactionMessages: Message[] = [
    ...messages,
    { role: "user", content: COMPACTION_PROMPT },
  ];

  let text = "";
  for await (const chunk of providerStream({
    model: currentModel,
    messages: compactionMessages,
    tools: [],
    onToolUse: async () => {},
    onToolResult: () => {},
  })) {
    text += chunk;
  }

  const match = text.match(/<summary>([\s\S]*?)<\/summary>/);
  const summary = match ? match[1]!.trim() : text;

  logger.llm.info("Compactação de contexto concluída", {
    model: currentModel,
    summaryLength: summary.length,
    durationMs: Date.now() - start,
    originalMessages: messages.length,
  });

  return [{ role: "user", content: `[Previous conversation compacted]\n\n${summary}` }];
}

// ── Unified stream ────────────────────────────────────────────────────────────

export function createClient(): unknown {
  return null; // kept for API compatibility, no longer used
}

export async function* streamResponse(
  _client: unknown,
  messages: Message[],
  tools: ToolDefinition[],
  onToolUse: (name: string, input: unknown) => Promise<void>,
  onToolResult: (result: ToolResult) => void,
  signal?: AbortSignal
): AsyncGenerator<string> {
  yield* providerStream({ model: currentModel, messages, tools, onToolUse, onToolResult, signal });
}
