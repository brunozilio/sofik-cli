import { test, expect, describe } from "bun:test";
import {
  setModel,
  getCurrentModel,
  estimateCost,
  shouldCompact,
  microcompact,
  createClient,
  compact,
  streamResponse,
} from "./anthropic.ts";
import type { Message } from "./types.ts";

// ── setModel / getCurrentModel ────────────────────────────────────────────────

describe("setModel / getCurrentModel", () => {
  const originalModel = getCurrentModel();

  test("getCurrentModel returns the current model", () => {
    expect(typeof getCurrentModel()).toBe("string");
    expect(getCurrentModel().length).toBeGreaterThan(0);
  });

  test("setModel changes the current model", () => {
    setModel("claude-sonnet-4-6");
    expect(getCurrentModel()).toBe("claude-sonnet-4-6");
  });

  test("setModel to haiku changes model to haiku", () => {
    setModel("claude-haiku-4-5");
    expect(getCurrentModel()).toBe("claude-haiku-4-5");
  });

  test("setModel to opus changes model to opus", () => {
    setModel("claude-opus-4-6");
    expect(getCurrentModel()).toBe("claude-opus-4-6");
  });

  test("setModel to same model does not throw", () => {
    const current = getCurrentModel();
    expect(() => setModel(current)).not.toThrow();
  });

  test("setModel accepts any string (custom model)", () => {
    setModel("my-custom-model");
    expect(getCurrentModel()).toBe("my-custom-model");
    // Restore
    setModel(originalModel);
  });

  test("getCurrentModel returns the last set model", () => {
    setModel("claude-sonnet-4-6");
    setModel("claude-haiku-4-5");
    setModel("claude-opus-4-6");
    expect(getCurrentModel()).toBe("claude-opus-4-6");
  });
});

// ── estimateCost ──────────────────────────────────────────────────────────────

describe("estimateCost", () => {
  test("returns a number", () => {
    const cost = estimateCost("claude-opus-4-6", { inputTokens: 1000, outputTokens: 500 });
    expect(typeof cost).toBe("number");
  });

  test("returns 0 for 0 tokens", () => {
    const cost = estimateCost("claude-opus-4-6", { inputTokens: 0, outputTokens: 0 });
    expect(cost).toBe(0);
  });

  test("calculates cost for claude-opus-4-6 correctly", () => {
    // Rate: input=$15/M, output=$75/M
    const cost = estimateCost("claude-opus-4-6", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(15 + 75, 2);
  });

  test("calculates cost for claude-sonnet-4-6 correctly", () => {
    // Rate: input=$3/M, output=$15/M
    const cost = estimateCost("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 15, 2);
  });

  test("calculates cost for claude-haiku-4-5 correctly", () => {
    // Rate: input=$0.8/M, output=$4/M
    const cost = estimateCost("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.8 + 4, 2);
  });

  test("uses default rates for unknown model (falls back to opus rates)", () => {
    // Unknown model uses { input: 15, output: 75 }
    const knownCost = estimateCost("claude-opus-4-6", { inputTokens: 500_000, outputTokens: 200_000 });
    const unknownCost = estimateCost("unknown-model-xyz", { inputTokens: 500_000, outputTokens: 200_000 });
    expect(unknownCost).toBeCloseTo(knownCost, 5);
  });

  test("scales linearly with tokens", () => {
    const cost1 = estimateCost("claude-opus-4-6", { inputTokens: 100_000, outputTokens: 0 });
    const cost2 = estimateCost("claude-opus-4-6", { inputTokens: 200_000, outputTokens: 0 });
    expect(cost2).toBeCloseTo(cost1 * 2, 5);
  });

  test("output tokens are more expensive than input for same model", () => {
    const inputCost = estimateCost("claude-opus-4-6", { inputTokens: 1_000_000, outputTokens: 0 });
    const outputCost = estimateCost("claude-opus-4-6", { inputTokens: 0, outputTokens: 1_000_000 });
    expect(outputCost).toBeGreaterThan(inputCost);
  });

  test("returns positive number for positive tokens", () => {
    const cost = estimateCost("claude-sonnet-4-6", { inputTokens: 10000, outputTokens: 5000 });
    expect(cost).toBeGreaterThan(0);
  });
});

// ── shouldCompact ─────────────────────────────────────────────────────────────

describe("shouldCompact", () => {
  test("returns false for empty messages", () => {
    setModel("claude-opus-4-6"); // 200K context
    const result = shouldCompact([]);
    expect(result).toBe(false);
  });

  test("returns false for small conversation", () => {
    setModel("claude-opus-4-6");
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    expect(shouldCompact(messages)).toBe(false);
  });

  test("returns true when conversation exceeds 80% of context window", () => {
    setModel("claude-opus-4-6"); // 200K context, threshold = 160K chars * 4 = 640K chars
    // Each char is ~0.25 tokens (1 token ≈ 4 chars)
    // 200K tokens * 0.8 = 160K tokens threshold
    // 160K tokens * 4 chars = 640K chars of JSON
    const bigContent = "x".repeat(700_000); // > 640K chars
    const messages: Message[] = [{ role: "user", content: bigContent }];
    expect(shouldCompact(messages)).toBe(true);
  });

  test("returns false just under the threshold", () => {
    setModel("claude-opus-4-6");
    // 200K * 0.8 = 160K token threshold
    // 160K tokens * 4 chars/token = 640K chars
    // JSON.stringify adds overhead, so we use a smaller size
    const smallContent = "x".repeat(100_000); // well under 640K chars
    const messages: Message[] = [{ role: "user", content: smallContent }];
    expect(shouldCompact(messages)).toBe(false);
  });

  test("uses the currently set model's context window", () => {
    // claude-3-7-sonnet has 32K context window (lower threshold)
    setModel("claude-3-7-sonnet");
    // 32K * 0.8 = 25.6K token threshold = 102.4K chars
    const content = "x".repeat(110_000); // > 102.4K chars
    const messages: Message[] = [{ role: "user", content }];
    const result = shouldCompact(messages);
    // Should compact because content is above 80% of 32K window
    expect(result).toBe(true);
    // Restore
    setModel("claude-opus-4-6");
  });

  test("returns boolean type", () => {
    const result = shouldCompact([]);
    expect(typeof result).toBe("boolean");
  });
});

// ── createClient ──────────────────────────────────────────────────────────────

describe("createClient", () => {
  test("returns null (legacy compatibility function)", () => {
    const client = createClient();
    expect(client).toBeNull();
  });

  test("can be called multiple times without error", () => {
    expect(() => {
      createClient();
      createClient();
      createClient();
    }).not.toThrow();
  });
});

// ── shouldCompact — lastInputTokens branch ────────────────────────────────────

describe("shouldCompact — with lastInputTokens", () => {
  test("returns true when ratio > 0.80 of context window", () => {
    setModel("claude-opus-4-6"); // 200K context window
    // 200_000 * 0.80 = 160_000 threshold. Pass 170_000 → ratio = 0.85
    expect(shouldCompact([], 170_000)).toBe(true);
  });

  test("returns false when ratio <= 0.80 of context window", () => {
    setModel("claude-opus-4-6"); // 200K context window
    // 200_000 * 0.80 = 160_000 threshold. Pass 100_000 → ratio = 0.50
    expect(shouldCompact([], 100_000)).toBe(false);
  });

  test("returns false at exactly 0.80 threshold", () => {
    setModel("claude-opus-4-6");
    // 200_000 * 0.80 = 160_000. At exactly 160_000 → ratio = 0.80 (not > 0.80)
    expect(shouldCompact([], 160_000)).toBe(false);
  });

  test("returns true just above 0.80 threshold", () => {
    setModel("claude-opus-4-6");
    expect(shouldCompact([], 160_001)).toBe(true);
  });

  test("messages argument is ignored when lastInputTokens is provided", () => {
    setModel("claude-opus-4-6");
    const bigMessages: Message[] = [{ role: "user", content: "x".repeat(700_000) }];
    // Even with huge messages, lastInputTokens=100 says we're fine
    expect(shouldCompact(bigMessages, 100)).toBe(false);
  });

  test("works with sonnet model (200K context too)", () => {
    setModel("claude-sonnet-4-6");
    // sonnet also 200K context
    expect(shouldCompact([], 170_000)).toBe(true);
    expect(shouldCompact([], 100_000)).toBe(false);
    setModel("claude-opus-4-6");
  });
});

// ── microcompact ──────────────────────────────────────────────────────────────

describe("microcompact", () => {
  test("returns same messages when no microcompact-able tools present", () => {
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = microcompact(messages);
    expect(result).toBe(messages); // same reference (no change)
  });

  test("returns same messages when tool count <= MICROCOMPACT_KEEP_LAST (3)", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "r1", content: "result1" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "r1", name: "Read", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "r2", content: "result2" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "r2", name: "Read", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "r3", content: "result3" }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "r3", name: "Read", input: {} }],
      },
    ];
    const result = microcompact(messages);
    expect(result).toBe(messages); // unchanged, only 3 occurrences of Read
  });

  test("clears old tool results when same tool used > 3 times", () => {
    // Build 4 Read calls: the first one should be cleared
    const messages: Message[] = [];
    for (let i = 1; i <= 4; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `r${i}`, name: "Read", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `r${i}`, content: `content${i}` }],
      });
    }

    const result = microcompact(messages);
    expect(result).not.toBe(messages); // a new array was returned

    // Find the tool_result for r1 (oldest) — it should be cleared
    const userMsgs = result.filter((m) => m.role === "user");
    const r1Msg = userMsgs.find((m) =>
      Array.isArray(m.content) &&
      m.content.some((b) => b.type === "tool_result" && b.tool_use_id === "r1")
    );
    expect(r1Msg).toBeDefined();
    const r1Block = (r1Msg!.content as Array<{ type: string; tool_use_id: string; content: string }>)
      .find((b) => b.tool_use_id === "r1");
    expect(r1Block!.content).toBe("[content cleared for context management]");
  });

  test("keeps the 3 most recent tool results intact", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 5; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `g${i}`, name: "Grep", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `g${i}`, content: `grep${i}` }],
      });
    }

    const result = microcompact(messages);

    // r3, r4, r5 should be kept (the last 3)
    const userMsgs = result.filter((m) => m.role === "user");
    for (const keepId of ["g3", "g4", "g5"]) {
      const msg = userMsgs.find((m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_result" && b.tool_use_id === keepId)
      );
      const block = (msg!.content as Array<{ type: string; tool_use_id: string; content: string }>)
        .find((b) => b.tool_use_id === keepId);
      expect(block!.content).not.toBe("[content cleared for context management]");
    }
  });

  test("does not touch non-microcompact tools (e.g. Write, Edit)", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 5; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `w${i}`, name: "Write", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `w${i}`, content: `write${i}` }],
      });
    }

    const result = microcompact(messages);
    // Write is not in MICROCOMPACT_TOOLS, so nothing changes
    expect(result).toBe(messages);
  });

  test("handles mixed messages with string content unchanged", () => {
    const messages: Message[] = [];
    messages.push({ role: "user", content: "plain string" });
    for (let i = 1; i <= 4; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `b${i}`, name: "Bash", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `b${i}`, content: `bash${i}` }],
      });
    }
    messages.push({ role: "user", content: "another string message" });

    const result = microcompact(messages);
    // The plain string messages should remain unchanged
    const stringMsgs = result.filter((m) => typeof m.content === "string");
    expect(stringMsgs[0].content).toBe("plain string");
    expect(stringMsgs[1].content).toBe("another string message");
  });

  test("returns new array when compaction occurs (does not mutate original)", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 4; i++) {
      messages.push({
        role: "assistant",
        content: [{ type: "tool_use", id: `g${i}`, name: "Glob", input: {} }],
      });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: `g${i}`, content: `glob${i}` }],
      });
    }

    const original = JSON.parse(JSON.stringify(messages));
    microcompact(messages);

    // Original should not be mutated
    expect(messages).toEqual(original);
  });

  test("handles multiple different tools each > 3 occurrences", () => {
    const messages: Message[] = [];
    // 4 Reads + 4 Greps interleaved
    for (let i = 1; i <= 4; i++) {
      messages.push({
        role: "assistant",
        content: [
          { type: "tool_use", id: `rd${i}`, name: "Read", input: {} },
          { type: "tool_use", id: `gr${i}`, name: "Grep", input: {} },
        ],
      });
      messages.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: `rd${i}`, content: `read${i}` },
          { type: "tool_result", tool_use_id: `gr${i}`, content: `grep${i}` },
        ],
      });
    }

    const result = microcompact(messages);
    expect(result).not.toBe(messages);

    // rd1 and gr1 (oldest of each) should be cleared
    const userMsgs = result.filter((m) => m.role === "user");
    const firstUserMsg = userMsgs[0];
    const blocks = firstUserMsg.content as Array<{ type: string; tool_use_id: string; content: string }>;
    const rd1 = blocks.find((b) => b.tool_use_id === "rd1");
    const gr1 = blocks.find((b) => b.tool_use_id === "gr1");
    expect(rd1!.content).toBe("[content cleared for context management]");
    expect(gr1!.content).toBe("[content cleared for context management]");
  });
});

// ── compact ───────────────────────────────────────────────────────────────────

describe("compact()", () => {
  test("is callable and requires auth (throws without credentials)", async () => {
    // Calling compact() covers the function and its initial lines.
    // Without authentication configured, it propagates the auth error from the provider.
    setModel("claude-opus-4-6");
    await expect(compact(null, [])).rejects.toThrow();
  }, 5000);

  test("accepts non-empty messages without crashing before auth check", async () => {
    setModel("claude-opus-4-6");
    const messages: Message[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    // Still throws on auth, but covers the code path that prepends COMPACTION_PROMPT
    await expect(compact(null, messages)).rejects.toThrow();
  }, 5000);

  test("success path: yields text, extracts <summary> tag, returns compacted messages", async () => {
    setModel("claude-opus-4-6");
    // Mock stream: calls onToolUse/onToolResult (covers no-op callbacks), then yields a summary
    async function* mockStream(params: Parameters<typeof compact>[2] extends infer F ? F extends (p: infer P) => unknown ? P : never : never) {
      await params.onToolUse("MockTool", { arg: 1 });
      params.onToolResult({ tool_use_id: "u1", content: "result", is_error: false });
      yield "<summary>compacted session summary</summary>";
    }
    const result = await compact(null, [{ role: "user", content: "hello" }], mockStream as Parameters<typeof compact>[2]);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("compacted session summary");
  });
});

// ── streamResponse (legacy) ───────────────────────────────────────────────────

describe("streamResponse() legacy wrapper", () => {
  test("is callable and requires auth (throws without credentials)", async () => {
    // Calling streamResponse() covers the function; auth error propagates from provider.
    setModel("claude-opus-4-6");
    const messages: Message[] = [{ role: "user", content: "test" }];
    const gen = streamResponse(null, messages, [], async () => {}, () => {});
    await expect(gen.next()).rejects.toThrow();
  }, 5000);
});
