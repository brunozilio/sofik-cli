import { test, expect, describe } from "bun:test";
import {
  setModel,
  getCurrentModel,
  estimateCost,
  shouldCompact,
  createClient,
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
