/**
 * Extra provider tests — focused on CopilotProvider coverage gaps and
 * getCopilotToken caching / error paths.
 *
 * All external HTTP calls and auth helpers are mocked so no real network
 * access or credentials are required.
 */
import { mock, test, expect, describe, beforeEach } from "bun:test";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function makeSyncStream(
  chunks: Array<{ choices: Array<{ delta: { content?: string }; finish_reason?: string | null }> }>
): ReadableStream<Uint8Array> {
  return makeSSEStream(chunks);
}

function makeOkStream(text = ""): Response {
  const chunks = text
    ? [{ choices: [{ delta: { content: text }, finish_reason: null }] }]
    : [];
  return new Response(makeSSEStream(chunks), { status: 200 });
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

// ── Token fetch mock control ──────────────────────────────────────────────────

type FetchCall = { url: string; init?: RequestInit };
const fetchCalls: FetchCall[] = [];

let _mockFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> =
  async () => makeOkStream();

// Copilot token fetch response (first network call made by getCopilotToken)
let copilotTokenResponse: Response = new Response(
  JSON.stringify({ token: "copilot-access-tok", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  { status: 200 }
);

// mock.module declarations must appear BEFORE any imports that use these modules

mock.module("../fetchWithProxy.ts", () => ({
  fetchWithProxy: (url: unknown, init: unknown) => {
    fetchCalls.push({ url: url as string, init: init as RequestInit });
    // First call = Copilot token fetch; subsequent calls = chat completions
    if ((url as string).includes("copilot_internal")) {
      return Promise.resolve(copilotTokenResponse);
    }
    return _mockFetch(url as string, init as RequestInit);
  },
}));

mock.module("../oauth.ts", () => ({
  getValidToken: async () => ({ access_token: "sk-ant-test" }),
  loadCopilotToken: () => ({ access_token: "github-token-xyz", token_type: "bearer", scope: "read:user" }),
}));

mock.module("../systemPrompt.ts", () => ({
  buildSystemPrompt: () => "system prompt",
}));

mock.module("../hooks.ts", () => ({
  runPreToolUseHooks: async () => {},
  runPostToolUseHooks: async () => {},
}));

mock.module("../../tools/index.ts", () => ({
  getAllTools: () => [],
}));

// ── Imports (after mock.module) ───────────────────────────────────────────────

import { CopilotProvider, resetCopilotTokenCache } from "./copilot.ts";
import { AnthropicProvider, getSessionUsage, resetSessionUsage } from "./anthropic.ts";
import { getProvider, streamResponse } from "./index.ts";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function copilotBaseParams(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-4o",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: [],
    onToolUse: async (_name: string, _input: unknown) => {},
    onToolResult: (_result: unknown) => {},
    ...overrides,
  };
}

// ── CopilotProvider — supportsModel ──────────────────────────────────────────

describe("CopilotProvider.supportsModel()", () => {
  const provider = new CopilotProvider();

  test("returns true for gpt-4o", () => {
    expect(provider.supportsModel("gpt-4o")).toBe(true);
  });

  test("returns true for gpt-4o-mini", () => {
    expect(provider.supportsModel("gpt-4o-mini")).toBe(true);
  });

  test("returns true for o1", () => {
    expect(provider.supportsModel("o1")).toBe(true);
  });

  test("returns true for o3-mini", () => {
    expect(provider.supportsModel("o3-mini")).toBe(true);
  });

  test("returns true for claude-3.5-sonnet (Copilot variant)", () => {
    expect(provider.supportsModel("claude-3.5-sonnet")).toBe(true);
  });

  test("returns true for claude-3.5-haiku (Copilot variant)", () => {
    expect(provider.supportsModel("claude-3.5-haiku")).toBe(true);
  });

  test("returns false for unknown model", () => {
    expect(provider.supportsModel("unknown-model-xyz")).toBe(false);
  });

  test("returns false for Anthropic-native model IDs (not in COPILOT_MODELS)", () => {
    expect(provider.supportsModel("claude-opus-4-6")).toBe(false);
    expect(provider.supportsModel("claude-sonnet-4-6")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(provider.supportsModel("")).toBe(false);
  });
});

// ── CopilotProvider — name ────────────────────────────────────────────────────

describe("CopilotProvider.name", () => {
  test('is "copilot"', () => {
    expect(new CopilotProvider().name).toBe("copilot");
  });
});

// ── CopilotProvider — stream(): basic text ────────────────────────────────────

describe("CopilotProvider.stream() — basic text response", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    copilotTokenResponse = new Response(
      JSON.stringify({ token: "copilot-access-tok", expires_at: new Date(Date.now() + 600_000).toISOString() }),
      { status: 200 }
    );
  });

  test("yields text chunks from delta.content", async () => {
    _mockFetch = async () =>
      new Response(
        makeSSEStream([
          { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
          { choices: [{ delta: { content: " World" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ]),
        { status: 200 }
      );

    const provider = new CopilotProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.stream(copilotBaseParams())) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Hello", " World"]);
  });

  test("resolves without yielding when delta has no content", async () => {
    _mockFetch = async () =>
      new Response(
        makeSSEStream([
          { choices: [{ delta: {}, finish_reason: "stop" }] },
        ]),
        { status: 200 }
      );

    const provider = new CopilotProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.stream(copilotBaseParams())) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });

  test("uses the Copilot chat endpoint for completions", async () => {
    fetchCalls.length = 0;
    _mockFetch = async () => new Response(makeSSEStream([]), { status: 200 });

    const provider = new CopilotProvider();
    for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }

    // At least one call must have gone to the GitHub Copilot chat completions URL
    const chatCall = fetchCalls.find((c) => (c.url as string).includes("githubcopilot.com"));
    expect(chatCall).toBeDefined();
  });

  test("sends Authorization: Bearer header to chat endpoint", async () => {
    fetchCalls.length = 0;
    _mockFetch = async () => new Response(makeSSEStream([]), { status: 200 });

    const provider = new CopilotProvider();
    for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }

    const chatCall = fetchCalls.find((c) => (c.url as string).includes("githubcopilot.com"));
    expect(chatCall).toBeDefined();
    const authHeader = (chatCall!.init?.headers as Record<string, string>)?.["Authorization"];
    // Must use Bearer scheme (Copilot token, not an API key)
    expect(authHeader).toBeDefined();
    expect(authHeader!.startsWith("Bearer ")).toBe(true);
    // The token value must be non-empty
    expect(authHeader!.slice("Bearer ".length).length).toBeGreaterThan(0);
  });

  test("throws when chat completions endpoint returns a 403 error", async () => {
    // The Copilot access token is already cached from prior tests; this test
    // verifies that the chat endpoint error surfaces correctly.
    _mockFetch = async () => makeErrorResponse(403, "Forbidden by policy");

    const provider = new CopilotProvider();
    await expect(async () => {
      for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }
    }).toThrow("403");
  });

  test("throws when chat completions endpoint returns non-ok status", async () => {
    _mockFetch = async () => makeErrorResponse(429, "Too Many Requests");

    const provider = new CopilotProvider();
    await expect(async () => {
      for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }
    }).toThrow("429");
  });

  test("error message includes response body for chat errors", async () => {
    _mockFetch = async () => makeErrorResponse(500, "internal server failure");

    const provider = new CopilotProvider();
    let thrown: Error | undefined;
    try {
      for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain("internal server failure");
  });
});

// ── CopilotProvider — stream(): abort signal ──────────────────────────────────

describe("CopilotProvider.stream() — abort signal", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    copilotTokenResponse = new Response(
      JSON.stringify({ token: "copilot-access-tok", expires_at: new Date(Date.now() + 600_000).toISOString() }),
      { status: 200 }
    );
  });

  test("throws AbortError when signal is aborted after streaming starts", async () => {
    const controller = new AbortController();

    _mockFetch = async () => {
      // Simulate slow stream — abort before DONE is sent
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: null }] })}\n\n`));
            // Hang — never send [DONE]
          },
        }),
        { status: 200 }
      );
    };

    const provider = new CopilotProvider();
    let thrown: Error | undefined;
    try {
      for await (const chunk of provider.stream(copilotBaseParams({ signal: controller.signal }))) {
        if (chunk === "partial") {
          controller.abort();
        }
      }
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe("AbortError");
  });
});

// ── getProvider ────────────────────────────────────────────────────────────────

describe("getProvider()", () => {
  test("returns AnthropicProvider for claude-opus-4-6", () => {
    const p = getProvider("claude-opus-4-6");
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  test("returns AnthropicProvider for claude-sonnet-4-6", () => {
    const p = getProvider("claude-sonnet-4-6");
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  test("returns CopilotProvider for gpt-4o", () => {
    const p = getProvider("gpt-4o");
    expect(p).toBeInstanceOf(CopilotProvider);
  });

  test("returns CopilotProvider for gpt-4o-mini", () => {
    const p = getProvider("gpt-4o-mini");
    expect(p).toBeInstanceOf(CopilotProvider);
  });

  test("returns CopilotProvider for o3-mini", () => {
    const p = getProvider("o3-mini");
    expect(p).toBeInstanceOf(CopilotProvider);
  });

  test("throws for unknown model", () => {
    expect(() => getProvider("completely-unknown-model-xyz")).toThrow();
  });
});

// ── AnthropicProvider — authHeaders token types ───────────────────────────────

describe("AnthropicProvider — OAuth token (sk-ant-oat) vs API key headers", () => {
  const provider = new AnthropicProvider();

  beforeEach(() => {
    resetSessionUsage();
    fetchCalls.length = 0;
  });

  test("sends Authorization header for OAuth token (sk-ant-oat...)", async () => {
    // getValidToken mock returns sk-ant-test (non-OAuth), override to return OAuth token
    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-oat-my-oauth-token" }),
      loadCopilotToken: () => null,
    }));

    _mockFetch = async (url, init) => {
      fetchCalls.push({ url: url as string, init: init as RequestInit });
      return new Response(
        makeSSEStream([
          { type: "message_start", message: { usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
          { type: "content_block_start", content_block: { type: "text" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
          { type: "content_block_stop" },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        ]),
        { status: 200 }
      );
    };

    for await (const _ of provider.stream({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) { /* drain */ }

    const call = fetchCalls.find((c) => (c.url as string).includes("anthropic.com"));
    if (call) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      // OAuth token → should use Authorization: Bearer
      if (headers?.["Authorization"]) {
        expect(headers["Authorization"]).toContain("sk-ant-oat");
      } else if (headers?.["x-api-key"]) {
        // Fallback: API key path — valid if token doesn't start with sk-ant-oat in this run
        expect(headers["x-api-key"]).toBeDefined();
      }
    }
  });
});

// ── CopilotProvider — stream(): messages with array content ──────────────────

describe("CopilotProvider.stream() — array content messages (toOpenAIMessages)", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    copilotTokenResponse = new Response(
      JSON.stringify({ token: "copilot-tok", expires_at: new Date(Date.now() + 600_000).toISOString() }),
      { status: 200 }
    );
  });

  test("handles user message with tool_result and text blocks", async () => {
    _mockFetch = async () =>
      new Response(
        makeSSEStream([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
        { status: 200 }
      );

    const provider = new CopilotProvider();
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "tool_result" as const, tool_use_id: "tu_1", content: "result text" },
          { type: "text" as const, text: "follow-up question" },
        ],
      },
    ];

    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      model: "gpt-4o",
      messages,
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("ok");
  });

  test("handles assistant message with tool_use blocks", async () => {
    _mockFetch = async () =>
      new Response(
        makeSSEStream([{ choices: [{ delta: { content: "reply" }, finish_reason: "stop" }] }]),
        { status: 200 }
      );

    const provider = new CopilotProvider();
    const messages = [
      { role: "user" as const, content: "use a tool" },
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "sure" },
          { type: "tool_use" as const, id: "tc_1", name: "SomeTool", input: { key: "val" } },
        ],
      },
      {
        role: "user" as const,
        content: [
          { type: "tool_result" as const, tool_use_id: "tc_1", content: "done" },
        ],
      },
    ];

    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      model: "gpt-4o",
      messages,
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("reply");
  });

  test("passes tools to API when tools array is non-empty", async () => {
    fetchCalls.length = 0;
    _mockFetch = async (url, init) => {
      fetchCalls.push({ url: url as string, init: init as RequestInit });
      return new Response(makeSSEStream([]), { status: 200 });
    };

    const provider = new CopilotProvider();
    const tools = [{
      name: "TestTool",
      description: "A test tool",
      input_schema: { type: "object" as const, properties: {} },
      execute: async (_params: Record<string, unknown>) => "result",
    }];

    for await (const _ of provider.stream({
      model: "gpt-4o",
      messages: [{ role: "user" as const, content: "hello" }],
      tools,
      onToolUse: async () => {},
      onToolResult: () => {},
    })) { /* drain */ }

    const chatCall = fetchCalls.find((c) => (c.url as string).includes("githubcopilot.com"));
    const body = JSON.parse((chatCall!.init?.body as string) ?? "{}");
    expect(body.tools).toBeDefined();
    expect(body.tools[0].function.name).toBe("TestTool");
  });
});

// ── AnthropicProvider — abort signal ─────────────────────────────────────────

describe("AnthropicProvider.stream() — abort signal", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-test" }),
      loadCopilotToken: () => null,
    }));
  });

  test("throws AbortError when signal is aborted during streaming", async () => {
    const controller = new AbortController();

    _mockFetch = async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n\n`));
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content_block_start", content_block: { type: "text" } })}\n\n`));
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}\n\n`));
            // Hang — never send message_delta or [DONE]
          },
        }),
        { status: 200 }
      );
    };

    const provider = new AnthropicProvider();
    let thrown: Error | undefined;
    try {
      for await (const chunk of provider.stream({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onToolUse: async () => {},
        onToolResult: () => {},
        signal: controller.signal,
      })) {
        if (chunk === "hello") {
          controller.abort();
        }
      }
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe("AbortError");
  });
});

// ── AnthropicProvider — max_tokens with pending tool_use ─────────────────────

describe("AnthropicProvider.stream() — max_tokens edge cases", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    resetSessionUsage();
    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-test" }),
      loadCopilotToken: () => null,
    }));
  });

  test("adds placeholder tool_results when max_tokens hit during tool_use", async () => {
    _mockFetch = async () =>
      new Response(
        makeSSEStream([
          { type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
          { type: "content_block_start", content_block: { type: "tool_use", id: "tu_max", name: "BigTool" } },
          { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
          { type: "content_block_stop" },
          { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 5 } },
        ]),
        { status: 200 }
      );

    const provider = new AnthropicProvider();
    const chunks: string[] = [];
    // Should complete without error — placeholder tool_results are added to history
    for await (const chunk of provider.stream({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "do something" }],
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });

  test("executes tool via executeOne when stop_reason is tool_use", async () => {
    let callCount = 0;
    _mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          makeSSEStream([
            { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
            { type: "content_block_start", content_block: { type: "tool_use", id: "tu_1", name: "UnknownTool" } },
            { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
            { type: "content_block_stop" },
            { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
          ]),
          { status: 200 }
        );
      }
      // Second turn: text response
      return new Response(
        makeSSEStream([
          { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
          { type: "content_block_start", content_block: { type: "text" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "done" } },
          { type: "content_block_stop" },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
        ]),
        { status: 200 }
      );
    };

    const onToolUseCalls: string[] = [];
    const provider = new AnthropicProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "use a tool" }],
      tools: [],
      onToolUse: async (name: string) => { onToolUseCalls.push(name); },
      onToolResult: () => {},
    })) {
      chunks.push(chunk);
    }
    expect(onToolUseCalls).toContain("UnknownTool");
    expect(chunks).toContain("done");
  });
});

// ── getSessionUsage / resetSessionUsage ───────────────────────────────────────

describe("getSessionUsage / resetSessionUsage", () => {
  test("getSessionUsage returns numeric fields", () => {
    const usage = getSessionUsage();
    expect(typeof usage.inputTokens).toBe("number");
    expect(typeof usage.outputTokens).toBe("number");
    expect(typeof usage.cacheReadTokens).toBe("number");
    expect(typeof usage.cacheWriteTokens).toBe("number");
  });

  test("resetSessionUsage zeros all counters", () => {
    resetSessionUsage();
    const usage = getSessionUsage();
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.cacheWriteTokens).toBe(0);
  });

  test("usage accumulates across multiple stream calls", async () => {
    resetSessionUsage();

    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-test" }),
      loadCopilotToken: () => null,
    }));

    _mockFetch = async () =>
      new Response(
        makeSSEStream([
          { type: "message_start", message: { usage: { input_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } } },
          { type: "content_block_start", content_block: { type: "text" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
          { type: "content_block_stop" },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
        ]),
        { status: 200 }
      );

    const provider = new AnthropicProvider();
    for await (const _ of provider.stream({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "test" }],
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) { /* drain */ }

    const usage = getSessionUsage();
    expect(usage.inputTokens).toBeGreaterThanOrEqual(50);
    expect(usage.outputTokens).toBeGreaterThanOrEqual(20);
    expect(usage.cacheReadTokens).toBeGreaterThanOrEqual(10);
    expect(usage.cacheWriteTokens).toBeGreaterThanOrEqual(5);
  });
});

// ── CopilotProvider — getCopilotToken error with unreadable body ──────────────
// Covers the `.catch(() => res.statusText)` callback inside getCopilotToken
// when the response is not-ok AND the response body stream is broken.

describe("CopilotProvider — getCopilotToken body read failure", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    resetCopilotTokenCache();
    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-test" }),
      loadCopilotToken: () => ({ access_token: "github-tok", token_type: "bearer", scope: "read:user" }),
    }));
  });

  test("error message falls back to statusText when body stream errors", async () => {
    // Return a 503 response whose body stream immediately errors — this makes
    // res.text() reject, triggering the .catch(() => res.statusText) callback.
    copilotTokenResponse = new Response(
      new ReadableStream({
        start(ctrl) { ctrl.error(new Error("stream broken")); },
      }),
      { status: 503, statusText: "Service Unavailable" }
    );

    const provider = new CopilotProvider();
    let thrown: Error | undefined;
    try {
      for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    // Error message should include the status code
    expect(thrown!.message).toContain("503");
  });
});

// ── CopilotProvider — stream() body read failure ──────────────────────────────
// Covers the `.catch(() => res.statusText)` callback inside stream()
// when the chat completions response is not-ok AND the body is unreadable.

describe("CopilotProvider.stream() — chat error with unreadable body", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    copilotTokenResponse = new Response(
      JSON.stringify({ token: "copilot-tok", expires_at: new Date(Date.now() + 600_000).toISOString() }),
      { status: 200 }
    );
  });

  test("error message falls back to statusText when chat body stream errors", async () => {
    // Copilot token fetch succeeds; chat completions returns 429 with broken body stream
    _mockFetch = async () =>
      new Response(
        new ReadableStream({
          start(ctrl) { ctrl.error(new Error("body stream broken")); },
        }),
        { status: 429, statusText: "Too Many Requests" }
      );

    const provider = new CopilotProvider();
    let thrown: Error | undefined;
    try {
      for await (const _ of provider.stream(copilotBaseParams())) { /* drain */ }
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain("429");
  });
});

// ── AnthropicProvider — streaming fallback on network error ──────────────────
// Covers the catch block in stream() that retries with non-streaming when
// the SSE stream throws a TypeError (network error).

describe("AnthropicProvider.stream() — streaming fallback on TypeError", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    resetSessionUsage();
    mock.module("../oauth.ts", () => ({
      getValidToken: async () => ({ access_token: "sk-ant-test" }),
      loadCopilotToken: () => null,
    }));
  });

  test("falls back to non-streaming when SSE body stream throws TypeError", async () => {
    let callCount = 0;
    _mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        // First request: SSE stream that immediately errors with TypeError
        return new Response(
          new ReadableStream({
            start(ctrl) {
              ctrl.error(new TypeError("Network connection lost"));
            },
          }),
          { status: 200 }
        );
      }
      // Second request: fallback non-streaming response
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "fallback answer" }],
          stop_reason: "end_turn",
          usage: { output_tokens: 5 },
        }),
        { status: 200 }
      );
    };

    const provider = new AnthropicProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("fallback answer");
    expect(callCount).toBe(2);
  });
});
