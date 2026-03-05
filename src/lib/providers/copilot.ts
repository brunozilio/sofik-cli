import type { LLMProvider, StreamParams } from "./types.ts";
import type { LocalContentBlock, Message, ToolResult } from "../types.ts";
import { COPILOT_MODELS } from "../models.ts";
import { buildSystemPrompt } from "../systemPrompt.ts";
import { loadCopilotToken } from "../oauth.ts";
import { fetchWithProxy } from "../fetchWithProxy.ts";
import { logger } from "../logger.ts";

const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL  = "https://api.githubcopilot.com/chat/completions";

// Short-lived Copilot token cache (~10 min TTL)
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Reset the in-memory token cache — used in tests to force a fresh network call. */
export function resetCopilotTokenCache(): void {
  cachedToken = null;
}

// 3 attempts (1 initial + 2 retries): max ~1500ms wait — fast enough for 5s test timeouts
async function withCopilotRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Parse status from "Copilot API error (429): ..."
      const statusMatch = errMsg.match(/\((\d{3})\)/);
      const status = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;
      // Don't retry on 4xx except 429
      if (status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt === 2) throw err;
      const delay = Math.min(500 * Math.pow(2, attempt), 4_000) + Math.random() * 200;
      logger.llm.warn("Copilot retry após erro", { attempt: attempt + 1, status, delayMs: Math.round(delay) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Max retry attempts exceeded");
}

async function getCopilotToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    logger.llm.debug("Token Copilot recuperado do cache");
    return cachedToken.value;
  }

  const github = loadCopilotToken();
  if (!github) throw new Error("Not logged in to GitHub Copilot. Run /login.");

  logger.llm.info("Buscando novo token Copilot");
  const res = await fetchWithProxy(COPILOT_TOKEN_URL, {
    headers: {
      "Authorization": `token ${github.access_token}`,
      "Accept": "application/json",
      "User-Agent": "GitHubCopilotChat/0.12.2023120601",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    logger.llm.error("Falha ao buscar token Copilot", { status: res.status });
    throw new Error(`Failed to get Copilot token (${res.status}): ${text}`);
  }

  const data = await res.json() as { token: string; expires_at: string };
  cachedToken = {
    value: data.token,
    expiresAt: new Date(data.expires_at).getTime(),
  };

  logger.llm.info("Token Copilot obtido", { expiresAt: data.expires_at });
  return data.token;
}

// ── Message conversion: our format → OpenAI format ───────────────────────────

type OpenAIRole = "system" | "user" | "assistant" | "tool";

interface OpenAIMsg {
  role: OpenAIRole;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function toOpenAIMessages(messages: Message[], systemPrompt: string): OpenAIMsg[] {
  const result: OpenAIMsg[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role as OpenAIRole, content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      for (const block of msg.content) {
        if (block.type === "tool_result") {
          result.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
      const text = msg.content
        .filter((b): b is Extract<LocalContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) result.push({ role: "user", content: text });

    } else if (msg.role === "assistant") {
      const textParts = msg.content
        .filter((b): b is Extract<LocalContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const toolCalls = msg.content
        .filter((b): b is Extract<LocalContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));

      const openAIMsg: OpenAIMsg = { role: "assistant" };
      if (textParts) openAIMsg.content = textParts;
      if (toolCalls.length > 0) openAIMsg.tool_calls = toolCalls;
      result.push(openAIMsg);
    }
  }

  return result;
}

function toOpenAITools(tools: import("../types.ts").ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class CopilotProvider implements LLMProvider {
  constructor() {}
  readonly name = "copilot";

  supportsModel(model: string): boolean {
    return model in COPILOT_MODELS;
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
    const systemPrompt = systemOverride ?? buildSystemPrompt();
    let currentMessages = messages;
    let turnCount = 0;

    while (true) {
      turnCount++;
      logger.setTurn(turnCount);
      // Refresh token each turn (cached; re-fetches only when near expiry)
      const token = await getCopilotToken();
      const body = {
        model,
        messages: toOpenAIMessages(currentMessages, systemPrompt),
        ...(tools.length > 0 && {
          tools: toOpenAITools(tools),
          tool_choice: "auto",
        }),
        stream: true,
      };

      const t0 = Date.now();
      logger.llm.info("Copilot API request", { model, turn: turnCount, messageCount: currentMessages.length, toolCount: tools.length });

      const res = await withCopilotRetry(() => fetchWithProxy(COPILOT_CHAT_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Copilot-Integration-Id": "vscode-chat",
          "Editor-Version": "vscode/1.85.0",
          "User-Agent": "GitHubCopilotChat/0.12.2023120601",
        },
        body: JSON.stringify(body),
        signal,
      }).then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => r.statusText);
          logger.llm.error("Copilot API erro", { model, status: r.status, turn: turnCount });
          throw new Error(`Copilot API error (${r.status}): ${text}`);
        }
        return r;
      }));

      logger.llm.info("Copilot API resposta recebida", { model, turn: turnCount, status: res.status, durationMs: Date.now() - t0 });

      const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
      let fullText = "";
      let finishReason: string | null = null;

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const onAbort = () => { reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break outer;

            let chunk: {
              choices?: Array<{
                delta?: {
                  content?: string;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
            };
            try { chunk = JSON.parse(data); } catch { continue; }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) finishReason = choice.finish_reason;
            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              fullText += delta.content;
              yield delta.content;
            }

            for (const tc of delta.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, { id: "", name: "", args: "" });
              }
              const entry = toolCallsMap.get(idx)!;
              if (tc.id)                  entry.id   += tc.id;
              if (tc.function?.name)      entry.name += tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
        reader.releaseLock();
      }

      if (signal?.aborted) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }

      // Break if there are no tool calls to execute
      if (toolCallsMap.size === 0) break;

      // "stop" means the model finished without wanting to call tools — respect it
      if (finishReason === "stop") break;

      // "length" = context limit hit mid-tool-generation — add error results and continue
      // (null or "tool_calls" → proceed normally)
      if (finishReason === "length") {
        logger.llm.warn("Copilot: length (context limit) durante tool_use — adicionando tool_results de erro e continuando", {
          model, turn: turnCount, toolCount: toolCallsMap.size,
        });
        const errorBlocks: LocalContentBlock[] = [];
        const assistantForError: LocalContentBlock[] = [];
        for (const tc of Array.from(toolCallsMap.values())) {
          let input: unknown = {};
          try { input = JSON.parse(tc.args || "{}"); } catch { /* empty */ }
          assistantForError.push({ type: "tool_use", id: tc.id, name: tc.name, input });
          errorBlocks.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: "Error: Response truncated due to context length limit. Please continue from where you left off.",
            is_error: true,
          });
        }
        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: assistantForError },
          { role: "user",      content: errorBlocks },
        ];
        continue;
      }

      // Build assistant content blocks
      const assistantContent: LocalContentBlock[] = [];
      if (fullText) assistantContent.push({ type: "text", text: fullText });

      const toolUses = Array.from(toolCallsMap.values());

      logger.llm.info("Copilot: turno concluído", {
        model,
        turn: turnCount,
        finishReason,
        toolCount: toolUses.length,
        ...(fullText ? { response: fullText.slice(0, 3000) } : {}),
        ...(toolUses.length > 0 ? { toolCalls: toolUses.map((t) => ({ name: t.name, id: t.id, input: t.args.slice(0, 500) })) } : {}),
      });

      for (const tc of toolUses) {
        let input: unknown = {};
        try { input = JSON.parse(tc.args || "{}"); } catch { /* empty */ }
        assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input });
      }

      // Execute tools
      const toolResultBlocks: LocalContentBlock[] = [];

      for (const tc of toolUses) {
        let input: unknown = {};
        try { input = JSON.parse(tc.args || "{}"); } catch {}

        await onToolUse(tc.name, input);

        const { getAllTools } = await import("../../tools/index.ts");
        const tool = getAllTools().find((t) => t.name === tc.name);

        let resultContent: string;
        let isError = false;

        if (!tool) {
          resultContent = `Error: Unknown tool "${tc.name}"`;
          isError = true;
          logger.tool.warn("Copilot: ferramenta desconhecida", { toolName: tc.name });
        } else {
          const toolT0 = Date.now();
          logger.setToolCall(tc.id);
          logger.tool.info("Copilot: ferramenta iniciada", { toolName: tc.name, id: tc.id });
          try {
            const { runPreToolUseHooks, runPostToolUseHooks } = await import("../hooks.ts");
            await runPreToolUseHooks(tc.name, input);
            resultContent = await tool.execute(input as Record<string, unknown>);
            await runPostToolUseHooks(tc.name, input, resultContent);
            logger.tool.info("Copilot: ferramenta concluída", { toolName: tc.name, id: tc.id, durationMs: Date.now() - toolT0, resultLength: resultContent.length, result: resultContent.slice(0, 3000) });
          } catch (err) {
            resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
            logger.tool.error("Copilot: ferramenta erro", { toolName: tc.name, id: tc.id, error: resultContent, durationMs: Date.now() - toolT0 });
          } finally {
            logger.setToolCall(undefined);
          }
        }

        const result: ToolResult = { tool_use_id: tc.id, content: resultContent, is_error: isError };
        onToolResult(result);
        toolResultBlocks.push({ type: "tool_result", ...result });
      }

      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: assistantContent },
        { role: "user",      content: toolResultBlocks },
      ];

      if (signal?.aborted) return;
    }
  }
}
