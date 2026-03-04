import { test, expect, describe, beforeEach, afterEach, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const fetchHits: Array<{ url: string; body: unknown }> = [];
let fetchShouldFail = false;

// Use globalThis.fetch mock instead of mock.module to avoid contaminating
// fetchWithProxy module for other test files (e.g. connector tests).
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // @ts-ignore
  globalThis.fetch = async (url: string, init: unknown): Promise<Response> => {
    if (fetchShouldFail) throw new Error("Network error");
    const body = init && typeof init === "object" && "body" in init
      ? JSON.parse((init as { body: string }).body)
      : null;
    fetchHits.push({ url, body });
    return new Response("ok", { status: 200 });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Write SOFIK.md config before hooks.ts module is first used.
// hooksConfig is null at module load time; it's only populated on first call to runPreToolUseHooks/runPostToolUseHooks.
// Since top-level code runs before any test body, the file will be present when the first test calls the hooks.
const sofik_dir = path.join(process.cwd(), ".sofik");
const sofik_md_path = path.join(sofik_dir, "SOFIK.md");

let originalSofik: string | null = null;
try { originalSofik = fs.readFileSync(sofik_md_path, "utf-8"); } catch { /* doesn't exist */ }

const hookConfig = {
  PreToolUse: [
    { matcher: { tools: ["TestTool"] }, hooks: [{ type: "http", url: "http://test-pre/hook" }] },
    { matcher: { tools: ["BashTool"] }, hooks: [{ type: "bash", command: "true" }] },
    { matcher: { tools: ["*"] }, hooks: [{ type: "http", url: "http://test-pre/wildcard" }] },
    { matcher: {}, hooks: [{ type: "http", url: "http://test-pre/nomatcher" }] },
  ],
  PostToolUse: [
    { matcher: { tools: ["PostTool"] }, hooks: [{ type: "http", url: "http://test-post/hook" }] },
    { matcher: { tools: ["FailTool"] }, hooks: [{ type: "bash", command: "exit 1" }] },
    { matcher: { tools: ["BashPre"] }, hooks: [{ type: "bash", command: "echo post-bash" }] },
    { matcher: {}, hooks: [{ type: "http", url: "http://test-post/nomatcher" }] },
  ],
};

fs.mkdirSync(sofik_dir, { recursive: true });
fs.writeFileSync(sofik_md_path, "```json:hooks\n" + JSON.stringify(hookConfig) + "\n```");

import { runPreToolUseHooks, runPostToolUseHooks, resetHooksConfig } from "./hooks.ts";

afterAll(() => {
  if (originalSofik !== null) {
    fs.writeFileSync(sofik_md_path, originalSofik);
  } else {
    try { fs.unlinkSync(sofik_md_path); } catch { /* ok */ }
  }
});

describe("runPreToolUseHooks", () => {
  test("sends HTTP hook for matched tool", async () => {
    const before = fetchHits.length;
    await runPreToolUseHooks("TestTool", { file: "test.ts" });
    const newHits = fetchHits.slice(before);
    const preHit = newHits.find((h) => h.url === "http://test-pre/hook");
    expect(preHit).toBeDefined();
  });

  test("HTTP hook context contains TOOL_NAME and TOOL_INPUT", async () => {
    const before = fetchHits.length;
    await runPreToolUseHooks("TestTool", { file: "context.ts" });
    const newHits = fetchHits.slice(before);
    const preHit = newHits.find((h) => h.url === "http://test-pre/hook");
    expect(preHit).toBeDefined();
    expect(preHit!.body).toMatchObject({ TOOL_NAME: "TestTool" });
    expect((preHit!.body as Record<string, string>).TOOL_INPUT).toContain("context.ts");
  });

  test("runs bash hook without throwing", async () => {
    await expect(runPreToolUseHooks("BashTool", {})).resolves.toBeUndefined();
  });

  test("wildcard matcher (*) matches any tool", async () => {
    const before = fetchHits.length;
    await runPreToolUseHooks("SomeRandomTool", {});
    const newHits = fetchHits.slice(before);
    const wildcardHit = newHits.find((h) => h.url === "http://test-pre/wildcard");
    expect(wildcardHit).toBeDefined();
  });

  test("empty matcher (no tools key) matches any tool", async () => {
    const before = fetchHits.length;
    await runPreToolUseHooks("AnyTool", {});
    const newHits = fetchHits.slice(before);
    const noMatcherHit = newHits.find((h) => h.url === "http://test-pre/nomatcher");
    expect(noMatcherHit).toBeDefined();
  });

  test("non-matching tool does not trigger TestTool-specific hook", async () => {
    const before = fetchHits.length;
    // "OtherTool" doesn't match { tools: ["TestTool"] }
    await runPreToolUseHooks("OtherTool", {});
    const newHits = fetchHits.slice(before);
    const preHit = newHits.find((h) => h.url === "http://test-pre/hook");
    expect(preHit).toBeUndefined();
  });

  test("HTTP hook failure does not throw", async () => {
    fetchShouldFail = true;
    try {
      await expect(runPreToolUseHooks("TestTool", {})).resolves.toBeUndefined();
    } finally {
      fetchShouldFail = false;
    }
  });

  test("resolves for tool with no matching hooks (only wildcard/nomatcher still fire)", async () => {
    await expect(runPreToolUseHooks("UnknownTool", {})).resolves.toBeUndefined();
  });
});

describe("runPostToolUseHooks", () => {
  test("sends HTTP hook for matched PostTool", async () => {
    const before = fetchHits.length;
    await runPostToolUseHooks("PostTool", {}, "some result");
    const newHits = fetchHits.slice(before);
    const postHit = newHits.find((h) => h.url === "http://test-post/hook");
    expect(postHit).toBeDefined();
  });

  test("HTTP hook context contains TOOL_NAME, TOOL_INPUT, TOOL_RESULT", async () => {
    const before = fetchHits.length;
    await runPostToolUseHooks("PostTool", { arg: "val" }, "my result");
    const newHits = fetchHits.slice(before);
    const postHit = newHits.find((h) => h.url === "http://test-post/hook");
    expect(postHit).toBeDefined();
    const body = postHit!.body as Record<string, string>;
    expect(body.TOOL_NAME).toBe("PostTool");
    expect(body.TOOL_INPUT).toContain("val");
    expect(body.TOOL_RESULT).toBe("my result");
  });

  test("bash hook with exit 1 does not throw (best-effort)", async () => {
    await expect(runPostToolUseHooks("FailTool", {}, "result")).resolves.toBeUndefined();
  });

  test("bash hook runs without error", async () => {
    await expect(runPostToolUseHooks("BashPre", {}, "result")).resolves.toBeUndefined();
  });

  test("empty matcher (no tools key) matches any tool", async () => {
    const before = fetchHits.length;
    await runPostToolUseHooks("AnyPostTool", {}, "result");
    const newHits = fetchHits.slice(before);
    const noMatcherHit = newHits.find((h) => h.url === "http://test-post/nomatcher");
    expect(noMatcherHit).toBeDefined();
  });

  test("TOOL_RESULT is truncated to 500 chars", async () => {
    const longResult = "x".repeat(600);
    const before = fetchHits.length;
    await runPostToolUseHooks("PostTool", {}, longResult);
    const newHits = fetchHits.slice(before);
    const postHit = newHits.find((h) => h.url === "http://test-post/hook");
    expect(postHit).toBeDefined();
    const body = postHit!.body as Record<string, string>;
    expect(body.TOOL_RESULT.length).toBe(500);
  });

  test("HTTP hook failure does not throw", async () => {
    fetchShouldFail = true;
    try {
      await expect(runPostToolUseHooks("PostTool", {}, "result")).resolves.toBeUndefined();
    } finally {
      fetchShouldFail = false;
    }
  });
});

// ── loadHooksConfig coverage for uncovered lines 70-72 ───────────────────────
// Lines 70-72 in hooks.ts are inside loadHooksConfig():
//   line 70: `}` closing `if (jsonMatch)` — reached when file exists but has no json:hooks
//   line 72: `}` closing the for loop — reached when the loop completes without returning
//
// We exercise this by running in a temp dir where:
//   - SOFIK.md exists at cwd but has NO json:hooks block
//   - No .sofik/SOFIK.md exists
//   - The home ~/.sofik/SOFIK.md may or may not exist (we can't control it)
// Result: loadHooksConfig returns {} — hooks are a no-op.

describe("loadHooksConfig — no-json-hooks path (lines 70-72)", () => {
  const origCwd = process.cwd();
  let tmpDir: string;

  beforeEach(() => {
    // Isolated temp dir with a SOFIK.md that has NO json:hooks block
    tmpDir = fs.mkdtempSync(path.join(path.dirname(sofik_dir), "sofik-hooks-no-json-"));
    fs.writeFileSync(path.join(tmpDir, "SOFIK.md"), "# No hooks here\nJust regular markdown.", "utf-8");
    process.chdir(tmpDir);
    resetHooksConfig();
  });

  afterEach(() => {
    process.chdir(origCwd);
    resetHooksConfig();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  test("PreToolUse is a no-op when SOFIK.md has no json:hooks", async () => {
    // loadHooksConfig finds SOFIK.md at cwd (line 65 succeeds) but jsonMatch is null (line 68 false)
    // → line 70 (closing `}`) and line 72 (loop close) are executed → returns {}
    await expect(runPreToolUseHooks("AnyTool", {})).resolves.toBeUndefined();
  });

  test("PostToolUse returns undefined when SOFIK.md has no json:hooks", async () => {
    const result = await runPostToolUseHooks("AnyTool", {}, "some result");
    expect(result).toBeUndefined();
  });

  test("loadHooksConfig returns {} when no candidate has json:hooks", async () => {
    // All candidates: cwd SOFIK.md exists without json:hooks, others don't exist
    // Lines 70, 72, 73 are all covered
    await runPreToolUseHooks("TestLoad", {});
    // Just verifying no error is thrown — hooks config is {} so nothing fires
    const before = fetchHits.length;
    await runPreToolUseHooks("TestLoad", {});
    // No HTTP hooks should fire (config is {})
    expect(fetchHits.length).toBe(before);
  });
});
