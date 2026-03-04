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

// ── Cost estimation (cache-aware) ─────────────────────────────────────────────

export type { UsageStats } from "./providers/anthropic.ts";

interface CostRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const COST_PER_M: Record<string, CostRates> = {
  "claude-opus-4-6":   { input: 15,  output: 75,  cacheRead: 1.50,  cacheWrite: 18.75 },
  "claude-sonnet-4-6": { input:  3,  output: 15,  cacheRead: 0.30,  cacheWrite:  3.75 },
  "claude-haiku-4-5":  { input: 0.8, output:  4,  cacheRead: 0.08,  cacheWrite:  1.00 },
};

export function estimateCost(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
): number {
  const rates = COST_PER_M[model] ?? { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 };
  return (
    (usage.inputTokens       / 1_000_000) * rates.input  +
    (usage.outputTokens      / 1_000_000) * rates.output +
    ((usage.cacheReadTokens  ?? 0) / 1_000_000) * rates.cacheRead  +
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * rates.cacheWrite
  );
}

// ── Microcompact (Tier 1 — clear old tool results) ────────────────────────────

const MICROCOMPACT_TOOLS = new Set([
  "Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "TodoRead",
]);
const MICROCOMPACT_KEEP_LAST = 3;

export function microcompact(messages: Message[]): Message[] {
  // Count occurrences of each tool result by tool name from tool_use blocks
  const toolCounts = new Map<string, number>();

  // First pass: count total occurrences of each tool in tool_use blocks
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && MICROCOMPACT_TOOLS.has(block.name)) {
          toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
        }
      }
    }
  }

  // Second pass: from back to front, track how many we've kept, clear old ones
  const keptCounts = new Map<string, number>();
  const toolUseIdToClear = new Set<string>();

  // Walk backwards through assistant messages to find tool_use ids to clear
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const block = msg.content[j]!;
        if (block.type === "tool_use" && MICROCOMPACT_TOOLS.has(block.name)) {
          const kept = keptCounts.get(block.name) ?? 0;
          if (kept < MICROCOMPACT_KEEP_LAST) {
            keptCounts.set(block.name, kept + 1);
          } else {
            // Mark this tool_use id for clearing in the corresponding tool_result
            toolUseIdToClear.add(block.id);
          }
        }
      }
    }
  }

  if (toolUseIdToClear.size === 0) return messages;

  // Clone messages, clearing tool_result content for marked ids
  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const newContent = msg.content.map((block) => {
        if (block.type === "tool_result" && toolUseIdToClear.has(block.tool_use_id)) {
          return { ...block, content: "[content cleared for context management]" };
        }
        return block;
      });
      return { ...msg, content: newContent };
    }
    return msg;
  });
}

// ── Compaction ────────────────────────────────────────────────────────────────

export function shouldCompact(messages: Message[], lastInputTokens?: number): boolean {
  const model = getModel(currentModel);
  if (lastInputTokens !== undefined) {
    const ratio = lastInputTokens / model.contextWindow;
    if (ratio > 0.80) {
      logger.llm.warn("Contexto atingiu limiar de compactação (tokens reais)", {
        model: currentModel,
        lastInputTokens,
        contextWindow: model.contextWindow,
        ratio: ratio.toFixed(2),
      });
      return true;
    }
    return false;
  }
  // Fallback: estimate
  const approxTokens = Math.ceil(JSON.stringify(messages).length / 4);
  const threshold = model.contextWindow * 0.8;
  if (approxTokens > threshold) {
    logger.llm.warn("Contexto atingiu limiar de compactação (estimado)", {
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
  signal?: AbortSignal,
  extraParams?: { thinkingBudget?: number; onUsageUpdate?: (n: number) => void; onThinking?: (t: string) => void }
): AsyncGenerator<string> {
  yield* providerStream({
    model: currentModel,
    messages,
    tools,
    onToolUse,
    onToolResult,
    signal,
    thinkingBudget: extraParams?.thinkingBudget,
    onUsageUpdate: extraParams?.onUsageUpdate,
    onThinking: extraParams?.onThinking,
  });
}
