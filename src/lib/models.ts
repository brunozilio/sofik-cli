export interface ModelInfo {
  contextWindow: number;
  maxOutput: number;
  label: string;
}

export const MODELS: Record<string, ModelInfo> = {
  "claude-opus-4-6":    { contextWindow: 200_000, maxOutput: 4096,  label: "Opus 4.6 (most capable)" },
  "claude-opus-4-5":    { contextWindow: 200_000, maxOutput: 4096,  label: "Opus 4.5" },
  "claude-opus-4-1":    { contextWindow: 100_000, maxOutput: 4096,  label: "Opus 4.1" },
  "claude-sonnet-4-6":  { contextWindow: 200_000, maxOutput: 4096,  label: "Sonnet 4.6 (fast + capable)" },
  "claude-sonnet-4-5":  { contextWindow: 200_000, maxOutput: 4096,  label: "Sonnet 4.5" },
  "claude-sonnet-4":    { contextWindow: 200_000, maxOutput: 4096,  label: "Sonnet 4" },
  "claude-3-7-sonnet":  { contextWindow:  32_000, maxOutput: 64000, label: "Sonnet 3.7" },
  "claude-3-5-sonnet":  { contextWindow: 200_000, maxOutput: 4096,  label: "Sonnet 3.5" },
  "claude-haiku-4-5":   { contextWindow: 100_000, maxOutput: 4096,  label: "Haiku 4.5 (fast)" },
  "claude-3-5-haiku":   { contextWindow: 200_000, maxOutput: 4096,  label: "Haiku 3.5" },
};

export const COPILOT_MODELS: Record<string, ModelInfo> = {
  "gpt-4o":             { contextWindow: 128_000, maxOutput: 16384, label: "GPT-4o" },
  "gpt-4o-mini":        { contextWindow: 128_000, maxOutput: 16384, label: "GPT-4o mini (fast)" },
  "o1":                 { contextWindow: 200_000, maxOutput: 100000, label: "o1 (reasoning)" },
  "o3-mini":            { contextWindow: 200_000, maxOutput: 100000, label: "o3-mini (fast reasoning)" },
  "claude-3.5-sonnet":  { contextWindow: 200_000, maxOutput: 4096,  label: "Claude Sonnet 3.5 (via Copilot)" },
  "claude-3.5-haiku":   { contextWindow: 200_000, maxOutput: 4096,  label: "Claude Haiku 3.5 (via Copilot)" },
};

export const DEFAULT_MODEL = "claude-opus-4-6";

export function getModel(name: string): ModelInfo {
  return MODELS[name] ?? { contextWindow: 200_000, maxOutput: 4096, label: name };
}

export function listModels(): string {
  return Object.entries(MODELS)
    .map(([id, info]) => `  ${id.padEnd(24)} — ${info.label} (${info.contextWindow / 1000}K ctx)`)
    .join("\n");
}
