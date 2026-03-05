import { mock, test, expect, describe, beforeEach } from "bun:test";

// ── Helper types & stream factories ───────────────────────────────────────────

function makeSSEStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const ev of events) {
        ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctrl.close();
    },
  });
}

function makeOkResponse(stream: ReadableStream): Response {
  return new Response(stream, { status: 200 });
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ── Dynamic mock control ───────────────────────────────────────────────────────

let _mockFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
  async () => makeOkResponse(makeSSEStream([]));

// ── mock.module declarations (hoisted by Bun, must be before imports) ─────────

mock.module("../fetchWithProxy.ts", () => ({
  fetchWithProxy: (url: unknown, init: unknown) =>
    _mockFetch(url as string, init as RequestInit),
}));

mock.module("../oauth.ts", () => ({
  getValidToken: async () => ({ access_token: "sk-ant-test123" }),
  loadCopilotToken: () => ({ access_token: "github-token-abc" }),
}));

mock.module("../systemPrompt.ts", () => ({
  buildSystemPrompt: () => "test system prompt",
}));

mock.module("../hooks.ts", () => ({
  runPreToolUseHooks: async () => {},
  runPostToolUseHooks: async () => {},
}));

mock.module("../../tools/index.ts", () => ({
  getAllTools: () => [],
}));

// ── Imports (after mock.module declarations) ──────────────────────────────────

import { AnthropicProvider, getSessionUsage, resetSessionUsage } from "./anthropic.ts";
import { CopilotProvider } from "./copilot.ts";
import { getProvider, streamResponse } from "./index.ts";

// ── Shared params builder ─────────────────────────────────────────────────────

function baseParams(overrides: Partial<Parameters<typeof streamResponse>[0]> = {}) {
  return {
    model: "claude-opus-4-6",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: [],
    onToolUse: async (_name: string, _input: unknown) => {},
    onToolResult: (_result: unknown) => {},
    ...overrides,
  };
}

function copilotParams(overrides: Partial<Parameters<typeof streamResponse>[0]> = {}) {
  return baseParams({ model: "gpt-4o", ...overrides });
}

// ── Anthropic SSE event factories ─────────────────────────────────────────────

function msgStart(usage = { input_tokens: 10, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 }) {
  return { type: "message_start", message: { usage } };
}

function contentBlockStartText() {
  return { type: "content_block_start", content_block: { type: "text" } };
}

function contentBlockStartToolUse(id: string, name: string) {
  return { type: "content_block_start", content_block: { type: "tool_use", id, name } };
}

function contentBlockDeltaText(text: string) {
  return { type: "content_block_delta", delta: { type: "text_delta", text } };
}

function contentBlockDeltaJson(partial_json: string) {
  return { type: "content_block_delta", delta: { type: "input_json_delta", partial_json } };
}

function contentBlockStop() {
  return { type: "content_block_stop" };
}

function messageDelta(stop_reason: string, usage = { output_tokens: 5 }) {
  return { type: "message_delta", delta: { stop_reason }, usage };
}

// ─────────────────────────────────────────────────────────────────────────────
// AnthropicProvider tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AnthropicProvider", () => {
  const provider = new AnthropicProvider();

  beforeEach(() => {
    resetSessionUsage();
    _mockFetch = async () => makeOkResponse(makeSSEStream([]));
  });

  test("constructor creates a valid instance", () => {
    const p = new AnthropicProvider();
    expect(typeof p.supportsModel).toBe("function");
  });

  // ── supportsModel ────────────────────────────────────────────────────────────

  describe("supportsModel()", () => {
    test("returns true for known Anthropic models", () => {
      expect(provider.supportsModel("claude-opus-4-6")).toBe(true);
      expect(provider.supportsModel("claude-sonnet-4-6")).toBe(true);
      expect(provider.supportsModel("claude-haiku-4-5")).toBe(true);
    });

    test("returns false for unknown models", () => {
      expect(provider.supportsModel("gpt-4o")).toBe(false);
      expect(provider.supportsModel("no-such-model")).toBe(false);
    });

    test("returns false for Copilot-only models", () => {
      expect(provider.supportsModel("gpt-4o-mini")).toBe(false);
      expect(provider.supportsModel("o1")).toBe(false);
    });
  });

  // ── stream: normal text response ─────────────────────────────────────────────

  describe("stream() — normal text", () => {
    test("yields text chunks from text_delta events", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("Hello"),
            contentBlockDeltaText(", world!"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );

      const chunks: string[] = [];
      for await (const chunk of provider.stream(baseParams())) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["Hello", ", world!"]);
    });

    test("updates sessionUsage with input and output tokens", async () => {
      resetSessionUsage();
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart({ input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 }),
            contentBlockStartText(),
            contentBlockDeltaText("hi"),
            contentBlockStop(),
            messageDelta("end_turn", { output_tokens: 50 }),
          ])
        );

      for await (const _ of provider.stream(baseParams())) { /* drain */ }

      const usage = getSessionUsage();
      expect(usage.inputTokens).toBe(100);
      expect(usage.cacheReadTokens).toBe(20);
      expect(usage.cacheWriteTokens).toBe(30);
      expect(usage.outputTokens).toBe(50);
    });

    test("handles message_start with no usage field gracefully", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            { type: "message_start", message: {} },
            contentBlockStartText(),
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams())) chunks.push(c);
      expect(chunks).toEqual(["ok"]);
    });

    test("handles message_delta with no usage gracefully", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            { type: "message_delta", delta: { stop_reason: "end_turn" } },
          ])
        );

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams())) chunks.push(c);
      expect(chunks).toEqual(["ok"]);
    });
  });

  // ── stream: API error ─────────────────────────────────────────────────────────

  describe("stream() — API error", () => {
    test("throws when response status is 401", async () => {
      _mockFetch = async () => makeErrorResponse(401, "Unauthorized");

      await expect(async () => {
        for await (const _ of provider.stream(baseParams())) { /* drain */ }
      }).toThrow("401");
    });

    test("throws when response status is 500", async () => {
      _mockFetch = async () => makeErrorResponse(500, "Internal Server Error");

      await expect(async () => {
        for await (const _ of provider.stream(baseParams())) { /* drain */ }
      }).toThrow("500");
    });

    test("error message includes response body text", async () => {
      _mockFetch = async () => makeErrorResponse(429, "rate limit exceeded");

      let thrown: Error | undefined;
      try {
        for await (const _ of provider.stream(baseParams())) { /* drain */ }
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toContain("rate limit exceeded");
    });
  });

  // ── stream: signal aborted ────────────────────────────────────────────────────

  describe("stream() — aborted signal", () => {
    test("returns early when signal is already aborted before fetch", async () => {
      let fetchCalled = false;
      _mockFetch = async () => {
        fetchCalled = true;
        return makeOkResponse(makeSSEStream([]));
      };

      const controller = new AbortController();
      controller.abort();

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams({ signal: controller.signal }))) {
        chunks.push(c);
      }

      expect(fetchCalled).toBe(false);
      expect(chunks).toEqual([]);
    });

    test("stops after tool phase when signal is aborted post-tool", async () => {
      // First request: returns tool_use; after tool execution signal is aborted
      const controller = new AbortController();
      let callCount = 0;

      _mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return makeOkResponse(
            makeSSEStream([
              msgStart(),
              contentBlockStartToolUse("tid1", "Read"),
              contentBlockDeltaJson('{"file_path":"/tmp/x"}'),
              contentBlockStop(),
              messageDelta("tool_use"),
            ])
          );
        }
        // Should not be reached because signal is aborted
        return makeOkResponse(makeSSEStream([msgStart(), contentBlockStartText(), contentBlockDeltaText("done"), contentBlockStop(), messageDelta("end_turn")]));
      };

      const onToolUse = async () => {
        controller.abort();
      };

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams({ signal: controller.signal, onToolUse }))) {
        chunks.push(c);
      }

      // Only one fetch call because the signal is aborted before the second turn
      expect(callCount).toBe(1);
    });
  });

  // ── stream: authHeaders ───────────────────────────────────────────────────────

  describe("stream() — auth headers", () => {
    test("uses x-api-key for regular sk-ant- tokens", async () => {
      let capturedInit: RequestInit | undefined;
      _mockFetch = async (_url, init) => {
        capturedInit = init;
        return makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("hi"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      // oauth mock returns "sk-ant-test123" (not starting with sk-ant-oat)
      for await (const _ of provider.stream(baseParams())) { /* drain */ }

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test123");
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["anthropic-beta"]).toBeUndefined();
    });

    test("uses Bearer + anthropic-beta for sk-ant-oat tokens", async () => {
      // Override the oauth mock just for this test via a closure trick
      // We need to mock getValidToken to return an oat token
      // Since mock.module is already registered, we test via a separate provider instance
      // that we can inject via a custom stream call — instead, we verify the header logic
      // by patching the mock dynamically through the module mock system.
      // The cleanest approach: test authHeaders logic indirectly by re-mocking oauth.
      mock.module("../oauth.ts", () => ({
        getValidToken: async () => ({ access_token: "sk-ant-oat-test-token" }),
        loadCopilotToken: () => ({ access_token: "github-token-abc" }),
      }));

      let capturedInit: RequestInit | undefined;
      _mockFetch = async (_url, init) => {
        capturedInit = init;
        return makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      // Import fresh to pick up the re-mocked oauth
      const { AnthropicProvider: FreshProvider } = await import("./anthropic.ts");
      const freshProvider = new FreshProvider();
      for await (const _ of freshProvider.stream(baseParams())) { /* drain */ }

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-ant-oat-test-token");
      expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(headers["x-api-key"]).toBeUndefined();

      // Restore original mock
      mock.module("../oauth.ts", () => ({
        getValidToken: async () => ({ access_token: "sk-ant-test123" }),
        loadCopilotToken: () => ({ access_token: "github-token-abc" }),
      }));
    });
  });

  // ── stream: tool use ──────────────────────────────────────────────────────────

  describe("stream() — tool use", () => {
    test("calls onToolUse and onToolResult, then continues with end_turn", async () => {
      let callCount = 0;
      _mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return makeOkResponse(
            makeSSEStream([
              msgStart(),
              contentBlockStartToolUse("tid1", "Read"),
              contentBlockDeltaJson('{"file_path":'),
              contentBlockDeltaJson('"/tmp/x"}'),
              contentBlockStop(),
              messageDelta("tool_use"),
            ])
          );
        }
        return makeOkResponse(
          makeSSEStream([
            msgStart({ input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
            contentBlockStartText(),
            contentBlockDeltaText("done"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      const toolUseCalls: Array<{ name: string; input: unknown }> = [];
      const toolResultCalls: unknown[] = [];

      for await (const _ of provider.stream(
        baseParams({
          onToolUse: async (name, input) => { toolUseCalls.push({ name, input }); },
          onToolResult: (result) => { toolResultCalls.push(result); },
        })
      )) { /* drain */ }

      expect(callCount).toBe(2);
      expect(toolUseCalls).toHaveLength(1);
      expect(toolUseCalls[0].name).toBe("Read");
      expect(toolResultCalls).toHaveLength(1);
    });

    test("returns error result when tool is not found in getAllTools", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartToolUse("tid-unknown", "NonExistentTool"),
            contentBlockDeltaJson("{}"),
            contentBlockStop(),
            messageDelta("tool_use"),
          ])
        );

      // After unknown tool, we need a second response to exit the loop
      let callCount = 0;
      _mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return makeOkResponse(
            makeSSEStream([
              msgStart(),
              contentBlockStartToolUse("tid-unknown", "NonExistentTool"),
              contentBlockDeltaJson("{}"),
              contentBlockStop(),
              messageDelta("tool_use"),
            ])
          );
        }
        return makeOkResponse(
          makeSSEStream([
            msgStart({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
            contentBlockStartText(),
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      const toolResultCalls: unknown[] = [];
      for await (const _ of provider.stream(
        baseParams({ onToolResult: (r) => toolResultCalls.push(r) })
      )) { /* drain */ }

      expect(toolResultCalls).toHaveLength(1);
      const result = toolResultCalls[0] as { is_error: boolean; content: string };
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("NonExistentTool");
    });

    test("parallel safe tools run in parallel (multiple PARALLEL_SAFE_TOOLS)", async () => {
      let callCount = 0;
      _mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return makeOkResponse(
            makeSSEStream([
              msgStart(),
              contentBlockStartToolUse("tid1", "Read"),
              contentBlockDeltaJson('{"file_path":"/a"}'),
              contentBlockStop(),
              contentBlockStartToolUse("tid2", "Glob"),
              contentBlockDeltaJson('{"pattern":"*"}'),
              contentBlockStop(),
              messageDelta("tool_use"),
            ])
          );
        }
        return makeOkResponse(
          makeSSEStream([
            msgStart({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
            contentBlockStartText(),
            contentBlockDeltaText("done"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      const toolUseCalls: string[] = [];
      for await (const _ of provider.stream(
        baseParams({ onToolUse: async (name) => { toolUseCalls.push(name); } })
      )) { /* drain */ }

      // Both tools should have been called
      expect(toolUseCalls).toContain("Read");
      expect(toolUseCalls).toContain("Glob");
    });

    test("sequential execution for non-parallel-safe tool", async () => {
      let callCount = 0;
      _mockFetch = async () => {
        callCount++;
        if (callCount === 1) {
          return makeOkResponse(
            makeSSEStream([
              msgStart(),
              contentBlockStartToolUse("tid1", "Bash"),
              contentBlockDeltaJson('{"command":"ls"}'),
              contentBlockStop(),
              messageDelta("tool_use"),
            ])
          );
        }
        return makeOkResponse(
          makeSSEStream([
            msgStart({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
            contentBlockStartText(),
            contentBlockDeltaText("done"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      const toolUseCalls: string[] = [];
      for await (const _ of provider.stream(
        baseParams({ onToolUse: async (name) => { toolUseCalls.push(name); } })
      )) { /* drain */ }

      expect(toolUseCalls).toEqual(["Bash"]);
    });

    test("systemOverride is used instead of buildSystemPrompt()", async () => {
      let capturedBody: string | undefined;
      _mockFetch = async (_url, init) => {
        capturedBody = init?.body as string;
        return makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );
      };

      for await (const _ of provider.stream(baseParams({ systemOverride: "custom prompt" }))) { /* drain */ }

      const parsed = JSON.parse(capturedBody!);
      expect(parsed.system[0].text).toBe("custom prompt");
    });

    test("content_block_stop without currentToolUse does not throw", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            contentBlockDeltaText("hello"),
            contentBlockStop(), // stop with no tool use in progress
            messageDelta("end_turn"),
          ])
        );

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams())) chunks.push(c);
      expect(chunks).toEqual(["hello"]);
    });

    test("input_json_delta without currentToolUse is ignored", async () => {
      _mockFetch = async () =>
        makeOkResponse(
          makeSSEStream([
            msgStart(),
            contentBlockStartText(),
            // spurious input_json_delta while text block is active
            { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
            contentBlockDeltaText("ok"),
            contentBlockStop(),
            messageDelta("end_turn"),
          ])
        );

      const chunks: string[] = [];
      for await (const c of provider.stream(baseParams())) chunks.push(c);
      expect(chunks).toEqual(["ok"]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UsageStats tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getSessionUsage / resetSessionUsage", () => {
  beforeEach(() => resetSessionUsage());

  test("getSessionUsage returns zeroed stats initially after reset", () => {
    const usage = getSessionUsage();
    expect(usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  test("getSessionUsage returns a copy — mutation does not affect module state", () => {
    const usage = getSessionUsage();
    usage.inputTokens = 9999;
    const usage2 = getSessionUsage();
    expect(usage2.inputTokens).toBe(0);
  });

  test("resetSessionUsage clears all counters to zero", async () => {
    _mockFetch = async () =>
      makeOkResponse(
        makeSSEStream([
          msgStart({ input_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }),
          contentBlockStartText(),
          contentBlockDeltaText("x"),
          contentBlockStop(),
          messageDelta("end_turn", { output_tokens: 20 }),
        ])
      );

    const provider = new AnthropicProvider();
    for await (const _ of provider.stream(baseParams())) { /* drain */ }

    let usage = getSessionUsage();
    expect(usage.inputTokens).toBeGreaterThan(0);

    resetSessionUsage();
    usage = getSessionUsage();
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  test("accumulated usage across multiple streams", async () => {
    const provider = new AnthropicProvider();
    const sseEvents = () => [
      msgStart({ input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      contentBlockStartText(),
      contentBlockDeltaText("hi"),
      contentBlockStop(),
      messageDelta("end_turn", { output_tokens: 3 }),
    ];

    _mockFetch = async () => makeOkResponse(makeSSEStream(sseEvents()));
    for await (const _ of provider.stream(baseParams())) { /* drain */ }

    _mockFetch = async () => makeOkResponse(makeSSEStream(sseEvents()));
    for await (const _ of provider.stream(baseParams())) { /* drain */ }

    const usage = getSessionUsage();
    expect(usage.inputTokens).toBe(20);
    expect(usage.outputTokens).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CopilotProvider tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CopilotProvider", () => {
  const provider = new CopilotProvider();

  beforeEach(() => {
    // Reset cached token between tests by forcing it to expire
    // (the module-level cachedToken will be refreshed on each first call)
    _mockFetch = async () => makeOkResponse(makeSSEStream([]));
  });

  test("constructor creates a valid instance", () => {
    const p = new CopilotProvider();
    expect(typeof p.supportsModel).toBe("function");
  });

  // ── supportsModel ────────────────────────────────────────────────────────────

  describe("supportsModel()", () => {
    test("returns true for known Copilot models", () => {
      expect(provider.supportsModel("gpt-4o")).toBe(true);
      expect(provider.supportsModel("gpt-4o-mini")).toBe(true);
      expect(provider.supportsModel("o1")).toBe(true);
      expect(provider.supportsModel("claude-3.5-sonnet")).toBe(true);
    });

    test("returns false for Anthropic-native models", () => {
      expect(provider.supportsModel("claude-opus-4-6")).toBe(false);
      expect(provider.supportsModel("claude-sonnet-4-6")).toBe(false);
    });

    test("returns false for unknown models", () => {
      expect(provider.supportsModel("unknown-model")).toBe(false);
    });
  });

  // ── getCopilotToken: loadCopilotToken returns null ────────────────────────────

  describe("getCopilotToken()", () => {
    test("throws 'Not logged in' when loadCopilotToken returns null", async () => {
      mock.module("../oauth.ts", () => ({
        getValidToken: async () => ({ access_token: "sk-ant-test123" }),
        loadCopilotToken: () => null,
      }));

      // Import fresh to pick up new mock
      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      await expect(async () => {
        for await (const _ of freshProvider.stream(copilotParams())) { /* drain */ }
      }).toThrow("Not logged in");

      // Restore
      mock.module("../oauth.ts", () => ({
        getValidToken: async () => ({ access_token: "sk-ant-test123" }),
        loadCopilotToken: () => ({ access_token: "github-token-abc" }),
      }));
    });

    test("throws when token fetch fails", async () => {
      // loadCopilotToken returns valid value but fetchWithProxy returns error
      let callCount = 0;
      _mockFetch = async (url) => {
        callCount++;
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeErrorResponse(403, "forbidden");
        }
        return makeOkResponse(makeSSEStream([]));
      };

      mock.module("../oauth.ts", () => ({
        getValidToken: async () => ({ access_token: "sk-ant-test123" }),
        loadCopilotToken: () => ({ access_token: "github-token-abc" }),
      }));

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      await expect(async () => {
        for await (const _ of freshProvider.stream(copilotParams())) { /* drain */ }
      }).toThrow("403");
    });
  });

  // ── stream: normal text ───────────────────────────────────────────────────────

  describe("stream() — normal text", () => {
    test("yields text from OpenAI SSE delta.content", async () => {
      const copilotEvents = [
        { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
        { choices: [{ delta: { content: " world" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ];

      let tokenFetchCount = 0;
      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          tokenFetchCount++;
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "copilot-tok-xyz", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        return makeOkResponse(makeSSEStream(copilotEvents));
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      const chunks: string[] = [];
      for await (const c of freshProvider.stream(copilotParams())) chunks.push(c);
      expect(chunks).toEqual(["hello", " world"]);
    });

    test("uses systemOverride when provided", async () => {
      let capturedBody: string | undefined;
      _mockFetch = async (url, init) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "copilot-tok-xyz2", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        capturedBody = init?.body as string;
        return makeOkResponse(
          makeSSEStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
        );
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();
      for await (const _ of freshProvider.stream(copilotParams({ systemOverride: "override prompt" }))) { /* drain */ }

      const parsed = JSON.parse(capturedBody!);
      const systemMsg = parsed.messages.find((m: { role: string }) => m.role === "system");
      expect(systemMsg?.content).toBe("override prompt");
    });
  });

  // ── stream: API error ─────────────────────────────────────────────────────────

  describe("stream() — API error", () => {
    test("throws on non-ok Copilot chat response", async () => {
      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-err", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        return makeErrorResponse(503, "Service Unavailable");
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      await expect(async () => {
        for await (const _ of freshProvider.stream(copilotParams())) { /* drain */ }
      }).toThrow("503");
    });
  });

  // ── stream: tool calls ────────────────────────────────────────────────────────

  describe("stream() — tool calls", () => {
    test("calls onToolUse and onToolResult for tool_calls finish reason", async () => {
      const toolChunks = [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", function: { name: "Read", arguments: '{"file_path":' } }] }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"/tmp/x"}' } }] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];
      const followupChunks = [
        { choices: [{ delta: { content: "result" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ];

      let chatCallCount = 0;
      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-tools", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        chatCallCount++;
        if (chatCallCount === 1) return makeOkResponse(makeSSEStream(toolChunks));
        return makeOkResponse(makeSSEStream(followupChunks));
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      const toolUseCalls: Array<{ name: string; input: unknown }> = [];
      const toolResultCalls: unknown[] = [];

      const chunks: string[] = [];
      for await (const c of freshProvider.stream(
        copilotParams({
          onToolUse: async (name, input) => { toolUseCalls.push({ name, input }); },
          onToolResult: (r) => { toolResultCalls.push(r); },
        })
      )) {
        chunks.push(c);
      }

      expect(toolUseCalls).toHaveLength(1);
      expect(toolUseCalls[0].name).toBe("Read");
      expect((toolUseCalls[0].input as { file_path: string }).file_path).toBe("/tmp/x");
      expect(toolResultCalls).toHaveLength(1);
      expect(chunks).toContain("result");
    });

    test("returns error result for unknown tool in Copilot", async () => {
      const toolChunks = [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc2", function: { name: "UnknownTool", arguments: "{}" } }] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];
      const followupChunks = [
        { choices: [{ delta: { content: "ok" }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ];

      let chatCallCount = 0;
      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-unk", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        chatCallCount++;
        if (chatCallCount === 1) return makeOkResponse(makeSSEStream(toolChunks));
        return makeOkResponse(makeSSEStream(followupChunks));
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      const toolResultCalls: unknown[] = [];
      for await (const _ of freshProvider.stream(
        copilotParams({ onToolResult: (r) => toolResultCalls.push(r) })
      )) { /* drain */ }

      expect(toolResultCalls).toHaveLength(1);
      const result = toolResultCalls[0] as { is_error: boolean; content: string };
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("UnknownTool");
    });

    test("stops after tool phase when signal is aborted", async () => {
      const controller = new AbortController();
      const toolChunks = [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "tc3", function: { name: "Read", arguments: '{}' } }] }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ];

      let chatCallCount = 0;
      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-abort", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        chatCallCount++;
        return makeOkResponse(makeSSEStream(toolChunks));
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      for await (const _ of freshProvider.stream(
        copilotParams({
          signal: controller.signal,
          onToolUse: async () => { controller.abort(); },
        })
      )) { /* drain */ }

      // Only one chat call — aborted before second turn
      expect(chatCallCount).toBe(1);
    });
  });

  // ── cached token reuse ────────────────────────────────────────────────────────

  describe("token cache", () => {
    test("reuses cached token — token endpoint called at most once across two stream calls", async () => {
      let tokenFetchCount = 0;
      let chatCallCount = 0;

      _mockFetch = async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          tokenFetchCount++;
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({
                      token: "cached-copilot-tok",
                      expires_at: new Date(Date.now() + 600_000).toISOString(),
                    })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        chatCallCount++;
        return makeOkResponse(
          makeSSEStream([
            { choices: [{ delta: { content: "hi" }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
          ])
        );
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      for await (const _ of freshProvider.stream(copilotParams())) { /* drain */ }
      for await (const _ of freshProvider.stream(copilotParams())) { /* drain */ }

      expect(chatCallCount).toBe(2);
      // Token should be fetched at most once (cached after the first fetch);
      // if a prior test already warmed the cache, tokenFetchCount may be 0.
      expect(tokenFetchCount).toBeLessThanOrEqual(1);
    });
  });

  // ── toOpenAIMessages: various message shapes ──────────────────────────────────

  describe("stream() — message conversion", () => {
    test("passes tool_result blocks as 'tool' role messages", async () => {
      let capturedBody: string | undefined;
      _mockFetch = async (url, init) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-conv", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        capturedBody = init?.body as string;
        return makeOkResponse(
          makeSSEStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
        );
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      const messages = [
        { role: "user" as const, content: "initial question" },
        {
          role: "assistant" as const,
          content: [
            { type: "tool_use" as const, id: "tu1", name: "Read", input: { file_path: "/x" } },
          ],
        },
        {
          role: "user" as const,
          content: [
            { type: "tool_result" as const, tool_use_id: "tu1", content: "file content", is_error: false },
          ],
        },
      ];

      for await (const _ of freshProvider.stream(copilotParams({ messages }))) { /* drain */ }

      const parsed = JSON.parse(capturedBody!);
      const toolMsg = parsed.messages.find((m: { role: string }) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg.tool_call_id).toBe("tu1");
      expect(toolMsg.content).toBe("file content");
    });

    test("passes assistant tool_use blocks as tool_calls", async () => {
      let capturedBody: string | undefined;
      _mockFetch = async (url, init) => {
        const urlStr = url.toString();
        if (urlStr.includes("copilot_internal")) {
          return makeOkResponse(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ token: "tok-conv2", expires_at: new Date(Date.now() + 600_000).toISOString() })
                  )
                );
                ctrl.close();
              },
            })
          );
        }
        capturedBody = init?.body as string;
        return makeOkResponse(
          makeSSEStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
        );
      };

      const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
      const freshProvider = new FreshCopilot();

      const messages = [
        { role: "user" as const, content: "do something" },
        {
          role: "assistant" as const,
          content: [
            { type: "text" as const, text: "I will use a tool" },
            { type: "tool_use" as const, id: "tu2", name: "Glob", input: { pattern: "*" } },
          ],
        },
        {
          role: "user" as const,
          content: [
            { type: "tool_result" as const, tool_use_id: "tu2", content: "results", is_error: false },
          ],
        },
      ];

      for await (const _ of freshProvider.stream(copilotParams({ messages }))) { /* drain */ }

      const parsed = JSON.parse(capturedBody!);
      const assistantMsg = parsed.messages.find(
        (m: { role: string; tool_calls?: unknown[] }) => m.role === "assistant" && m.tool_calls
      );
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.tool_calls[0].function.name).toBe("Glob");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// index.ts — getProvider / streamResponse
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition coverage: exercise toOpenAITools (copilot) and apiTools map (anthropic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Tool definitions passed to providers", () => {
  const sampleTool = {
    name: "Read",
    description: "Read a file",
    input_schema: {
      type: "object" as const,
      properties: { file_path: { type: "string" } },
      required: ["file_path"],
    },
    execute: async (_input: Record<string, unknown>) => "contents",
  };

  test("AnthropicProvider passes tools to API request body", async () => {
    let capturedBody: string | undefined;
    _mockFetch = async (_url, init) => {
      capturedBody = init?.body as string;
      return makeOkResponse(
        makeSSEStream([
          msgStart(),
          contentBlockStartText(),
          contentBlockDeltaText("ok"),
          contentBlockStop(),
          messageDelta("end_turn"),
        ])
      );
    };

    const provider = new AnthropicProvider();
    for await (const _ of provider.stream(baseParams({ tools: [sampleTool] }))) { /* drain */ }

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].name).toBe("Read");
    expect(parsed.tools[0].description).toBe("Read a file");
    expect(parsed.tools[0].input_schema).toBeDefined();
  });

  test("CopilotProvider passes tools to API request body via toOpenAITools", async () => {
    let capturedBody: string | undefined;
    _mockFetch = async (url, init) => {
      const urlStr = url.toString();
      if (urlStr.includes("copilot_internal")) {
        return makeOkResponse(
          new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ token: "tok-tools2", expires_at: new Date(Date.now() + 600_000).toISOString() })
                )
              );
              ctrl.close();
            },
          })
        );
      }
      capturedBody = init?.body as string;
      return makeOkResponse(
        makeSSEStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }])
      );
    };

    const { CopilotProvider: FreshCopilot } = await import("./copilot.ts");
    const freshProvider = new FreshCopilot();
    for await (const _ of freshProvider.stream(copilotParams({ tools: [sampleTool] }))) { /* drain */ }

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0].type).toBe("function");
    expect(parsed.tools[0].function.name).toBe("Read");
    expect(parsed.tools[0].function.description).toBe("Read a file");
    expect(parsed.tools[0].function.parameters).toBeDefined();
    // tool_choice should be set when tools are present
    expect(parsed.tool_choice).toBe("auto");
  });
});

describe("getProvider()", () => {
  test("returns AnthropicProvider for Anthropic model", () => {
    const p = getProvider("claude-opus-4-6");
    expect(p.name).toBe("anthropic");
  });

  test("returns CopilotProvider for Copilot model", () => {
    const p = getProvider("gpt-4o");
    expect(p.name).toBe("copilot");
  });

  test("throws for unknown model with descriptive message", () => {
    expect(() => getProvider("no-such-model-xyz")).toThrow(
      'No provider found for model "no-such-model-xyz"'
    );
  });

  test("error message lists available providers", () => {
    let thrown: Error | undefined;
    try {
      getProvider("no-such-model-xyz");
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown?.message).toContain("anthropic");
    expect(thrown?.message).toContain("copilot");
  });
});

describe("streamResponse()", () => {
  test("delegates to the matching provider stream", async () => {
    _mockFetch = async () =>
      makeOkResponse(
        makeSSEStream([
          msgStart(),
          contentBlockStartText(),
          contentBlockDeltaText("streamed"),
          contentBlockStop(),
          messageDelta("end_turn"),
        ])
      );

    const chunks: string[] = [];
    for await (const c of streamResponse(baseParams())) chunks.push(c);
    expect(chunks).toContain("streamed");
  });

  test("throws for unsupported model", async () => {
    await expect(async () => {
      for await (const _ of streamResponse(baseParams({ model: "unknown-xyz" }))) { /* drain */ }
    }).toThrow('No provider found for model "unknown-xyz"');
  });
});
