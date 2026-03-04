import type { LLMProvider, StreamParams } from "./types.ts";
import type { LocalContentBlock, ToolResult } from "../types.ts";
import type { Message } from "../types.ts";
import { MODELS } from "../models.ts";
import { buildSystemPrompt } from "../systemPrompt.ts";
import { getValidToken } from "../oauth.ts";
import { fetchWithProxy } from "../fetchWithProxy.ts";
import { logger } from "../logger.ts";

const BASE_URL = "https://api.anthropic.com/v1";

// Tools safe to execute in parallel (read-only, no side effects)
const PARALLEL_SAFE_TOOLS = new Set([
  "Read", "Glob", "Grep", "WebFetch", "WebSearch", "TaskGet", "TaskList",
]);

async function resolveToken(): Promise<string> {
  logger.auth.info("Resolvendo token de acesso");
  const token = await getValidToken();
  if (token) {
    logger.auth.info("Token de acesso resolvido com sucesso");
    return token.access_token;
  }
  logger.auth.error("Token não disponível — usuário não autenticado");
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

// ── Retry with exponential backoff ────────────────────────────────────────────

let consecutive529 = 0;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 10,
  currentModel?: string,
  onFallback?: (newModel: string) => void
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn();
      consecutive529 = 0;
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Parse HTTP status from error message if available
      const statusMatch = errMsg.match(/^(\d{3})\s/);
      const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;

      // Don't retry on 4xx except 429
      if (status >= 400 && status < 500 && status !== 429) throw err;

      if (status === 529) {
        consecutive529++;
        if (consecutive529 >= 3 && currentModel && onFallback) {
          // Fallback: opus → sonnet
          const fallback = currentModel.includes("opus") ? "claude-sonnet-4-6" : currentModel;
          if (fallback !== currentModel) {
            logger.llm.warn("3x HTTP 529 — fazendo fallback de modelo", { from: currentModel, to: fallback });
            onFallback(fallback);
          }
        }
      }

      if (attempt === maxAttempts - 1) throw err;

      // Respect Retry-After header if present in the error message
      let delay = Math.min(500 * Math.pow(2, attempt), 32_000) + Math.random() * 200;
      const retryAfterMatch = errMsg.match(/retry-after:\s*(\d+)/i);
      if (retryAfterMatch) {
        delay = Math.max(delay, parseInt(retryAfterMatch[1]!, 10) * 1000);
      }

      logger.llm.warn("Retry após erro", { attempt: attempt + 1, maxAttempts, status, delayMs: Math.round(delay) });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retry attempts exceeded");
}

// ── SSE parser ────────────────────────────────────────────────────────────────

async function* parseSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("StreamStallError")), 60_000)
        ),
      ]);
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
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

// ── Message format ────────────────────────────────────────────────────────────

function toApiParam(msg: Message): unknown {
  if (typeof msg.content === "string") return { role: msg.role, content: msg.content };
  return { role: msg.role, content: msg.content };
}

// ── Cache breakpoint injection ────────────────────────────────────────────────

function injectCacheBreakpoint(apiMessages: unknown[]): void {
  // Find last user message and add cache_control to its last content block
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const msg = apiMessages[i] as { role: string; content: unknown };
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        // Convert to block form with cache_control
        (apiMessages[i] as Record<string, unknown>).content = [
          { type: "text", text: msg.content, cache_control: { type: "ephemeral" } },
        ];
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const last = msg.content[msg.content.length - 1] as Record<string, unknown>;
        last.cache_control = { type: "ephemeral" };
      }
      break;
    }
  }
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
    maxTurns,
    thinkingBudget,
    onUsageUpdate,
    onThinking,
  }: StreamParams): AsyncGenerator<string> {
    const modelInfo = MODELS[model] ?? { maxOutput: 8096 };
    const token = await resolveToken();
    const ah = authHeaders(token);

    const betas: string[] = [];
    if (thinkingBudget) {
      betas.push("interleaved-thinking-2025-05-14");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...ah,
    };
    if (betas.length > 0) {
      const existing = (headers["anthropic-beta"] ?? "").split(",").filter(Boolean);
      headers["anthropic-beta"] = [...existing, ...betas].join(",");
    }

    const apiTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const apiMessages: unknown[] = messages.map(toApiParam);

    let hasAttemptedReactiveCompact = false;
    let currentModel = model;

    const onModelFallback = (newModel: string) => {
      currentModel = newModel;
    };

    let turnIndex = 0;
    while (true) {
      turnIndex++;
      const contentBlocks: LocalContentBlock[] = [];
      const thinkingBlocks: string[] = [];

      if (signal?.aborted) return;

      // Inject cache breakpoint on last user message
      injectCacheBreakpoint(apiMessages);

      logger.llm.info("Requisição LLM iniciada", {
        model: currentModel,
        turn: turnIndex,
        messageCount: apiMessages.length,
        toolCount: apiTools.length,
        thinkingBudget,
      });

      const reqStart = Date.now();

      const buildBody = () => {
        const body: Record<string, unknown> = {
          model: currentModel,
          max_tokens: modelInfo.maxOutput,
          system: [{ type: "text", text: systemOverride ?? buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
          messages: apiMessages,
          tools: apiTools,
          stream: true,
        };
        if (thinkingBudget) {
          body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
        }
        return body;
      };

      let response: Response;
      try {
        response = await withRetry(
          () => fetchWithProxy(`${BASE_URL}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify(buildBody()),
            signal: signal ?? undefined,
          }),
          10,
          currentModel,
          onModelFallback
        );
      } catch (err) {
        throw err;
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.llm.error("Requisição LLM falhou", { model: currentModel, status: response.status, error: errorText.slice(0, 500) });

        // Reactive compact on prompt_too_long
        if (
          response.status === 400 &&
          (errorText.includes("prompt is too long") || errorText.includes("invalid_request_error")) &&
          !hasAttemptedReactiveCompact
        ) {
          hasAttemptedReactiveCompact = true;
          logger.llm.warn("prompt_too_long detectado — iniciando compactação reativa");
          const { compact } = await import("../anthropic.ts");
          const compacted = await compact(null, messages);
          // Replace apiMessages with compacted
          apiMessages.length = 0;
          for (const m of compacted.map(toApiParam)) apiMessages.push(m);
          turnIndex--;
          continue;
        }

        throw new Error(`${response.status} ${errorText}`);
      }

      logger.llm.info("Resposta LLM recebida — iniciando stream", { model: currentModel, status: response.status, durationMs: Date.now() - reqStart });

      let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
      let currentThinkingText = "";
      let isInThinkingBlock = false;
      let stopReason = "end_turn";
      let usedStreamingFallback = false;

      try {
        for await (const event of parseSSE(response.body!, signal)) {
          const type = event.type as string;

          if (type === "message_start") {
            const usage = (event.message as { usage?: RawUsage })?.usage;
            if (usage) {
              addUsage(usage);
              const inputToks = usage.input_tokens ?? 0;
              if (inputToks > 0) onUsageUpdate?.(inputToks);
              logger.llm.info("Uso de tokens (início)", {
                model: currentModel,
                inputTokens: inputToks,
                cacheReadTokens: usage.cache_read_input_tokens ?? 0,
                cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
              });
            }
          } else if (type === "content_block_start") {
            const block = event.content_block as { type: string; id?: string; name?: string };
            if (block.type === "text") {
              contentBlocks.push({ type: "text", text: "" });
              isInThinkingBlock = false;
            } else if (block.type === "thinking") {
              isInThinkingBlock = true;
              currentThinkingText = "";
            } else if (block.type === "tool_use") {
              isInThinkingBlock = false;
              currentToolUse = { id: block.id!, name: block.name!, inputJson: "" };
              contentBlocks.push({ type: "tool_use", id: block.id!, name: block.name!, input: {} });
              logger.llm.info("LLM invocando ferramenta", { tool: block.name, id: block.id });
            }
          } else if (type === "content_block_delta") {
            const delta = event.delta as { type: string; text?: string; partial_json?: string; thinking?: string };
            if (delta.type === "thinking_delta" && delta.thinking) {
              currentThinkingText += delta.thinking;
            } else if (delta.type === "text_delta" && delta.text) {
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
          } else if (type === "content_block_stop") {
            if (isInThinkingBlock && currentThinkingText) {
              thinkingBlocks.push(currentThinkingText);
              onThinking?.(currentThinkingText);
              currentThinkingText = "";
              isInThinkingBlock = false;
            }
            if (currentToolUse) {
              const last = contentBlocks[contentBlocks.length - 1];
              if (last?.type === "tool_use") {
                try { last.input = JSON.parse(currentToolUse.inputJson || "{}"); } catch { /* leave */ }
              }
              currentToolUse = null;
            }
          } else if (type === "message_delta") {
            const delta = event.delta as { stop_reason?: string };
            stopReason = delta.stop_reason ?? "end_turn";
            const usage = (event as { usage?: RawUsage }).usage;
            if (usage) {
              addUsage(usage);
              logger.llm.info("Uso de tokens (fim do turno)", {
                model: currentModel,
                stopReason,
                outputTokens: usage.output_tokens ?? 0,
              });
            }
          }
        }
      } catch (streamErr) {
        const isStall = streamErr instanceof Error && streamErr.message === "StreamStallError";
        const isNetwork = streamErr instanceof TypeError;
        if (!isStall && !isNetwork) throw streamErr;
        if (usedStreamingFallback) throw streamErr;
        usedStreamingFallback = true;

        logger.llm.warn("Stream falhou, usando non-streaming fallback", { model: currentModel, error: streamErr instanceof Error ? streamErr.message : String(streamErr) });

        // Reset partial state and retry without streaming
        contentBlocks.length = 0;
        currentToolUse = null;
        stopReason = "end_turn";

        const fallbackBody: Record<string, unknown> = {
          model: currentModel,
          max_tokens: modelInfo.maxOutput,
          system: [{ type: "text", text: systemOverride ?? buildSystemPrompt(), cache_control: { type: "ephemeral" } }],
          messages: apiMessages,
          tools: apiTools,
        };
        if (thinkingBudget) {
          fallbackBody.thinking = { type: "enabled", budget_tokens: thinkingBudget };
        }

        const fallbackResponse = await fetchWithProxy(`${BASE_URL}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify(fallbackBody),
          signal: signal ?? undefined,
        });

        if (!fallbackResponse.ok) {
          const errText = await fallbackResponse.text();
          throw new Error(`${fallbackResponse.status} ${errText}`);
        }

        interface NonStreamingBlock {
          type: string;
          text?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }
        interface NonStreamingResponse {
          content: NonStreamingBlock[];
          stop_reason?: string;
          usage?: RawUsage;
        }

        const json = await fallbackResponse.json() as NonStreamingResponse;
        stopReason = json.stop_reason ?? "end_turn";
        if (json.usage) addUsage(json.usage);

        for (const block of json.content) {
          if (block.type === "thinking" && block.thinking) {
            onThinking?.(block.thinking);
          } else if (block.type === "text" && block.text) {
            contentBlocks.push({ type: "text", text: block.text });
            yield block.text;
          } else if (block.type === "tool_use" && block.id && block.name) {
            contentBlocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
          }
        }
      }

      if (signal?.aborted) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }

      apiMessages.push({ role: "assistant", content: contentBlocks });

      const toolUses = contentBlocks.filter(
        (b): b is Extract<LocalContentBlock, { type: "tool_use" }> => b.type === "tool_use"
      );

      logger.llm.info("Turno LLM concluído", { model: currentModel, stopReason, toolUseCount: toolUses.length, turn: turnIndex });

      if (stopReason !== "tool_use" || toolUses.length === 0) {
        // If max_tokens hit mid-tool-use, add placeholder tool_results and
        // continue the loop so the LLM can recover and resume the task.
        if (stopReason === "max_tokens" && toolUses.length > 0) {
          logger.llm.warn("max_tokens atingido durante tool_use — adicionando tool_results de erro e continuando", {
            model: currentModel, toolCount: toolUses.length,
          });
          apiMessages.push({
            role: "user",
            content: toolUses.map((t) => ({
              type: "tool_result",
              tool_use_id: t.id,
              content: "Error: Response truncated due to max_tokens limit. Please continue from where you left off.",
              is_error: true,
            })),
          });
          if (maxTurns !== undefined && turnIndex >= maxTurns) break;
          contentBlocks.length = 0;
          continue;
        }
        break;
      }
      if (maxTurns !== undefined && turnIndex >= maxTurns) break;

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
          logger.tool.error("Ferramenta desconhecida", { tool: toolUse.name, id: toolUse.id });
        } else {
          const toolStart = Date.now();
          logger.tool.info("Executando ferramenta", {
            tool: toolUse.name,
            id: toolUse.id,
            input: JSON.stringify(toolUse.input).slice(0, 300),
          });
          try {
            const { runPreToolUseHooks, runPostToolUseHooks } = await import("../hooks.ts");
            await runPreToolUseHooks(toolUse.name, toolUse.input);
            resultContent = await tool.execute(toolUse.input as Record<string, unknown>);
            const hookFeedback = await runPostToolUseHooks(toolUse.name, toolUse.input, resultContent);
            if (hookFeedback) {
              resultContent += `\n\n[Hook feedback]:\n${hookFeedback}`;
            }
            logger.tool.info("Ferramenta concluída", {
              tool: toolUse.name,
              id: toolUse.id,
              durationMs: Date.now() - toolStart,
              resultLength: resultContent.length,
            });
          } catch (err) {
            resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
            logger.tool.error("Ferramenta falhou", {
              tool: toolUse.name,
              id: toolUse.id,
              durationMs: Date.now() - toolStart,
              error: resultContent,
            });
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
  consecutive529 = 0;
}

function addUsage(u: RawUsage): void {
  sessionUsage.inputTokens += u.input_tokens ?? 0;
  sessionUsage.outputTokens += u.output_tokens ?? 0;
  sessionUsage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  sessionUsage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
}
