import { test, expect, describe } from "bun:test";
import {
  MODELS,
  COPILOT_MODELS,
  DEFAULT_MODEL,
  getModel,
  listModels,
  type ModelInfo,
} from "./models.ts";

describe("MODELS", () => {
  test("contains claude-opus-4-6", () => {
    expect(MODELS["claude-opus-4-6"]).toBeDefined();
  });

  test("claude-opus-4-6 has correct values", () => {
    const m = MODELS["claude-opus-4-6"]!;
    expect(m.contextWindow).toBe(200_000);
    expect(m.maxOutput).toBe(8096);
    expect(m.label).toBe("Opus 4.6 (most capable)");
  });

  test("contains claude-sonnet-4-6", () => {
    expect(MODELS["claude-sonnet-4-6"]).toBeDefined();
    expect(MODELS["claude-sonnet-4-6"]!.label).toBe("Sonnet 4.6 (fast + capable)");
  });

  test("contains claude-opus-4-5", () => {
    expect(MODELS["claude-opus-4-5"]).toBeDefined();
    expect(MODELS["claude-opus-4-5"]!.contextWindow).toBe(200_000);
  });

  test("contains claude-opus-4-1 with smaller context window", () => {
    expect(MODELS["claude-opus-4-1"]).toBeDefined();
    expect(MODELS["claude-opus-4-1"]!.contextWindow).toBe(100_000);
    expect(MODELS["claude-opus-4-1"]!.maxOutput).toBe(4096);
  });

  test("contains claude-sonnet-4-5", () => {
    expect(MODELS["claude-sonnet-4-5"]).toBeDefined();
    expect(MODELS["claude-sonnet-4-5"]!.maxOutput).toBe(4096);
  });

  test("contains claude-sonnet-4", () => {
    expect(MODELS["claude-sonnet-4"]).toBeDefined();
  });

  test("contains claude-3-7-sonnet with large maxOutput", () => {
    expect(MODELS["claude-3-7-sonnet"]).toBeDefined();
    expect(MODELS["claude-3-7-sonnet"]!.maxOutput).toBe(64000);
    expect(MODELS["claude-3-7-sonnet"]!.contextWindow).toBe(32_000);
  });

  test("contains claude-3-5-sonnet", () => {
    expect(MODELS["claude-3-5-sonnet"]).toBeDefined();
  });

  test("contains claude-haiku-4-5 with smaller context", () => {
    expect(MODELS["claude-haiku-4-5"]).toBeDefined();
    expect(MODELS["claude-haiku-4-5"]!.contextWindow).toBe(100_000);
  });

  test("contains claude-3-5-haiku", () => {
    expect(MODELS["claude-3-5-haiku"]).toBeDefined();
  });

  test("has exactly 10 models", () => {
    expect(Object.keys(MODELS).length).toBe(10);
  });

  test("all models have required fields", () => {
    for (const [id, info] of Object.entries(MODELS)) {
      expect(typeof info.contextWindow).toBe("number");
      expect(typeof info.maxOutput).toBe("number");
      expect(typeof info.label).toBe("string");
      expect(info.label.length).toBeGreaterThan(0);
    }
  });
});

describe("COPILOT_MODELS", () => {
  test("contains gpt-4o", () => {
    expect(COPILOT_MODELS["gpt-4o"]).toBeDefined();
    expect(COPILOT_MODELS["gpt-4o"]!.label).toBe("GPT-4o");
  });

  test("gpt-4o has correct values", () => {
    const m = COPILOT_MODELS["gpt-4o"]!;
    expect(m.contextWindow).toBe(128_000);
    expect(m.maxOutput).toBe(16384);
  });

  test("contains gpt-4o-mini", () => {
    expect(COPILOT_MODELS["gpt-4o-mini"]).toBeDefined();
    expect(COPILOT_MODELS["gpt-4o-mini"]!.label).toBe("GPT-4o mini (fast)");
  });

  test("contains o1", () => {
    expect(COPILOT_MODELS["o1"]).toBeDefined();
    expect(COPILOT_MODELS["o1"]!.maxOutput).toBe(100000);
  });

  test("contains o3-mini", () => {
    expect(COPILOT_MODELS["o3-mini"]).toBeDefined();
    expect(COPILOT_MODELS["o3-mini"]!.label).toBe("o3-mini (fast reasoning)");
  });

  test("contains claude-3.5-sonnet via Copilot", () => {
    expect(COPILOT_MODELS["claude-3.5-sonnet"]).toBeDefined();
    expect(COPILOT_MODELS["claude-3.5-sonnet"]!.label).toBe("Claude Sonnet 3.5 (via Copilot)");
  });

  test("contains claude-3.5-haiku via Copilot", () => {
    expect(COPILOT_MODELS["claude-3.5-haiku"]).toBeDefined();
    expect(COPILOT_MODELS["claude-3.5-haiku"]!.label).toBe("Claude Haiku 3.5 (via Copilot)");
  });

  test("has exactly 6 models", () => {
    expect(Object.keys(COPILOT_MODELS).length).toBe(6);
  });

  test("all copilot models have required fields", () => {
    for (const [id, info] of Object.entries(COPILOT_MODELS)) {
      expect(typeof info.contextWindow).toBe("number");
      expect(typeof info.maxOutput).toBe("number");
      expect(typeof info.label).toBe("string");
    }
  });
});

describe("DEFAULT_MODEL", () => {
  test("is claude-opus-4-6", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-4-6");
  });

  test("is a key in MODELS", () => {
    expect(MODELS[DEFAULT_MODEL]).toBeDefined();
  });
});

describe("getModel", () => {
  test("returns known model by exact key", () => {
    const m = getModel("claude-opus-4-6");
    expect(m.contextWindow).toBe(200_000);
    expect(m.maxOutput).toBe(8096);
    expect(m.label).toBe("Opus 4.6 (most capable)");
  });

  test("returns correct info for claude-sonnet-4-6", () => {
    const m = getModel("claude-sonnet-4-6");
    expect(m.label).toBe("Sonnet 4.6 (fast + capable)");
  });

  test("returns correct info for claude-3-7-sonnet", () => {
    const m = getModel("claude-3-7-sonnet");
    expect(m.maxOutput).toBe(64000);
    expect(m.contextWindow).toBe(32_000);
  });

  test("returns fallback for unknown model with name as label", () => {
    const name = "some-unknown-model-xyz";
    const m = getModel(name);
    expect(m.label).toBe(name);
    expect(m.contextWindow).toBe(200_000);
    expect(m.maxOutput).toBe(8096);
  });

  test("fallback has correct default contextWindow", () => {
    const m = getModel("not-a-real-model");
    expect(m.contextWindow).toBe(200_000);
  });

  test("fallback has correct default maxOutput", () => {
    const m = getModel("not-a-real-model");
    expect(m.maxOutput).toBe(8096);
  });

  test("empty string returns fallback with empty label", () => {
    const m = getModel("");
    expect(m.label).toBe("");
    expect(m.contextWindow).toBe(200_000);
  });
});

describe("listModels", () => {
  test("returns a string", () => {
    expect(typeof listModels()).toBe("string");
  });

  test("contains all 10 model IDs", () => {
    const result = listModels();
    for (const id of Object.keys(MODELS)) {
      expect(result).toContain(id);
    }
  });

  test("contains claude-opus-4-6", () => {
    expect(listModels()).toContain("claude-opus-4-6");
  });

  test("contains claude-sonnet-4-6", () => {
    expect(listModels()).toContain("claude-sonnet-4-6");
  });

  test("contains claude-haiku-4-5", () => {
    expect(listModels()).toContain("claude-haiku-4-5");
  });

  test("contains context window info in K notation", () => {
    const result = listModels();
    expect(result).toContain("200K ctx");
  });

  test("contains context window info for 32K model", () => {
    const result = listModels();
    expect(result).toContain("32K ctx");
  });

  test("contains context window info for 100K model", () => {
    const result = listModels();
    expect(result).toContain("100K ctx");
  });

  test("contains all model labels", () => {
    const result = listModels();
    for (const info of Object.values(MODELS)) {
      expect(result).toContain(info.label);
    }
  });

  test("each model appears on its own line", () => {
    const lines = listModels().split("\n");
    expect(lines.length).toBe(Object.keys(MODELS).length);
  });

  test("contains em dash separator", () => {
    expect(listModels()).toContain("—");
  });

  test("lines are indented with spaces", () => {
    const lines = listModels().split("\n");
    for (const line of lines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });
});
