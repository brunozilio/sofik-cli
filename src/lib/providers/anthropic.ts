import type { LLMProvider, StreamParams } from "./types.ts";
import type { LocalContentBlock, ToolResult } from "../types.ts";
import type { Message } from "../types.ts";
import { MODELS } from "../models.ts";
import { buildSystemPrompt } from "../systemPrompt.ts";
import { getValidToken } from "../oauth.ts";

const BASE_URL = "https://api.anthropic.com/v1";

// Tools safe to execute in parallel (read-only, no side effects)
const PARALLEL_SAFE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebFetch", "WebSearch", "TaskGet", "TaskList",
]);

async function resolveToken(): Promise<string> {
  const token = await getValidToken();
  if (token) return token.access_token;
  throw new Error("Não autenticado. Use /login dentro do chat para entrar.");
}

function authHeaders(token: string): Record<string, string> {
  if (token.startsWith("sk-ant-oat")) {
    return {
      "Authorization": `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    };
  }
  return { "x-api-key": token };
}

// ── SSE parser ────────────────────────────────────────────────────────────────

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        try { yield JSON.parse(data); } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Message format ────────────────────────────────────────────────────────────

function toApiParam(msg: Message): unknown {
  if (typeof msg.content === "string") return { role: msg.role, content: msg.content };
  return { role: msg.role, content: msg.content };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  supportsModel(model: string): boolean {
    return model in MODELS;
  }

  async *stream({
    model,
    messages,
    tools,
    onToolUse,
    onToolResult,
    signal,
    systemOverride,
  }: StreamParams): AsyncGenerator<string> {
    const modelInfo = MODELS[model] ?? { maxOutput: 8096 };
    const token = await resolveToken();
    const ah = authHeaders(token);
    const headers = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...ah,
    };

    const apiTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const apiMessages: unknown[] = messages.map(toApiParam);

    while (true) {
      const contentBlocks: LocalContentBlock[] = [];

      if (signal?.aborted) return;

      const response = await fetch(`${BASE_URL}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: modelInfo.maxOutput,
          system: [{ type: "text", text: systemOverride ?? buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
          messages: apiMessages,
          tools: apiTools,
          stream: true,
        }),
        signal: signal ?? undefined,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`${response.status} ${error}`);
      }

      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      let stopReason = "end_turn";

      for await (const event of parseSSE(response.body!)) {
        const type = event.type as string;

        if (type === "message_start") {
          const usage = (event.message as { usage?: RawUsage })?.usage;
          if (usage) addUsage(usage);
        } else if (type === "content_block_start") {
          const block = event.content_block as { type: string; id?: string; name?: string };
          if (block.type === "text") {
            contentBlocks.push({ type: "text", text: "" });
          } else if (block.type === "tool_use") {
            currentToolUse = { id: block.id!, name: block.name!, inputJson: "" };
            contentBlocks.push({ type: "tool_use", id: block.id!, name: block.name!, input: {} });
          }
        } else if (type === "content_block_delta") {
          const delta = event.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === "text_delta" && delta.text) {
            const last = contentBlocks[contentBlocks.length - 1];
            if (last?.type === "text") last.text += delta.text;
            yield delta.text;
          } else if (delta.type === "input_json_delta" && currentToolUse && delta.partial_json) {
            currentToolUse.inputJson += delta.partial_json;
            const last = contentBlocks[contentBlocks.length - 1];
            if (last?.type === "tool_use") {
              try { last.input = JSON.parse(currentToolUse.inputJson); } catch { /* accumulating */ }
            }
          }
        } else if (type === "content_block_stop" && currentToolUse) {
          const last = contentBlocks[contentBlocks.length - 1];
          if (last?.type === "tool_use") {
            try { last.input = JSON.parse(currentToolUse.inputJson || "{}"); } catch { /* leave */ }
          }
          currentToolUse = null;
        } else if (type === "message_delta") {
          const delta = event.delta as { stop_reason?: string };
          stopReason = delta.stop_reason ?? "end_turn";
          const usage = (event as { usage?: RawUsage }).usage;
          if (usage) addUsage(usage);
        }
      }

      apiMessages.push({ role: "assistant", content: contentBlocks });

      const toolUses = contentBlocks.filter(
        (b): b is Extract<LocalContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      if (stopReason !== "tool_use" || toolUses.length === 0) break;

      // Phase 1: Sequential permission checks
      for (const toolUse of toolUses) {
        await onToolUse(toolUse.name, toolUse.input);
      }

      // Helper to execute a single tool
      const executeOne = async (
        toolUse: Extract<LocalContentBlock, { type: "tool_use" }>
      ): Promise<{ type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }> => {
        const { getAllTools } = await import("../../tools/index.ts");
        const tool = getAllTools().find((t) => t.name === toolUse.name);
        let resultContent: string;
        let isError = false;

        if (!tool) {
          resultContent = `Error: Unknown tool "${toolUse.name}"`;
          isError = true;
        } else {
          try {
            const { runPreToolUseHooks, runPostToolUseHooks } = await import("../hooks.ts");
            await runPreToolUseHooks(toolUse.name, toolUse.input);
            resultContent = await tool.execute(toolUse.input as Record<string, unknown>);
            await runPostToolUseHooks(toolUse.name, toolUse.input, resultContent);
          } catch (err) {
            resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
          }
        }

        const result: ToolResult = { tool_use_id: toolUse.id, content: resultContent, is_error: isError };
        onToolResult(result);
        return { type: "tool_result", tool_use_id: toolUse.id, content: resultContent, is_error: isError };
      };

      // Phase 2: Parallel execution for safe tools, sequential otherwise
      const allParallelSafe = toolUses.every((t) => PARALLEL_SAFE_TOOLS.has(t.name));
      const toolResults = allParallelSafe && toolUses.length > 1
        ? await Promise.all(toolUses.map(executeOne))
        : await toolUses.reduce(
            async (acc, toolUse) => [...(await acc), await executeOne(toolUse)],
            Promise.resolve([] as Awaited<ReturnType<typeof executeOne>>[])
          );

      apiMessages.push({ role: "user", content: toolResults });

      if (signal?.aborted) return;
    }
  }
}

// ── Usage tracking ────────────────────────────────────────────────────────────

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const sessionUsage: UsageStats = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function getSessionUsage(): UsageStats {
  return { ...sessionUsage };
}

export function resetSessionUsage(): void {
  sessionUsage.inputTokens = 0;
  sessionUsage.outputTokens = 0;
  sessionUsage.cacheReadTokens = 0;
  sessionUsage.cacheWriteTokens = 0;
}

function addUsage(u: RawUsage): void {
  sessionUsage.inputTokens += u.input_tokens ?? 0;
  sessionUsage.outputTokens += u.output_tokens ?? 0;
  sessionUsage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  sessionUsage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
}
