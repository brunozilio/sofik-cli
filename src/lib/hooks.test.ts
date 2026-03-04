import { mock, test, expect, describe, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const fetchHits: Array<{ url: string; body: unknown }> = [];
let fetchShouldFail = false;

mock.module("./fetchWithProxy.ts", () => ({
  fetchWithProxy: async (url: string, init: unknown) => {
    if (fetchShouldFail) throw new Error("Network error");
    const body = init && typeof init === "object" && "body" in init
      ? JSON.parse((init as { body: string }).body)
      : null;
    fetchHits.push({ url, body });
    return new Response("ok", { status: 200 });
  },
}));

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

import { runPreToolUseHooks, runPostToolUseHooks } from "./hooks.ts";

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
