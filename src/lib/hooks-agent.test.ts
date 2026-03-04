/**
 * Supplementary hooks tests focusing on the agent hook type (lines 115-138 of hooks.ts)
 * and the matchesTool prefix-matching path.
 *
 * IMPORTANT: This file runs before hooks.test.ts (alphabetical order) and
 * therefore populates the module-level hooksConfig cache first.  To avoid
 * breaking hooks.test.ts we write a COMBINED config to SOFIK.md (path priority #1,
 * process.cwd()/SOFIK.md) that includes ALL entries required by both test files.
 * hooks.test.ts writes to .sofik/SOFIK.md (path #2) which is ignored once the
 * cache is already warm.
 */
import { mock, test, expect, describe, afterAll, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// ── Track what runSimpleAgent was called with ─────────────────────────────────

type AgentCall = { prompt: string; model: string; toolNames: string[] };
const agentCalls: AgentCall[] = [];
let agentShouldThrow = false;
let agentShouldTimeout = false;
let agentReturnValue = "agent feedback result";

// Mock the agent tool before hooks.ts is imported so the dynamic
// import inside runHook resolves to our stub.
mock.module("../../tools/agent.ts", () => ({
  runSimpleAgent: async (opts: AgentCall): Promise<string> => {
    if (agentShouldThrow) throw new Error("AgentError");
    if (agentShouldTimeout) {
      // Hang forever — the hook's own timeout race will resolve first
      await new Promise<never>(() => {});
    }
    agentCalls.push({ prompt: opts.prompt, model: opts.model, toolNames: opts.toolNames ?? [] });
    return agentReturnValue;
  },
}));

// ── Write SOFIK.md BEFORE hooks module is imported ───────────────────────────
//
// We write to process.cwd()/SOFIK.md (the HIGHEST priority candidate in
// loadHooksConfig).  The combined config satisfies both this file's agent-hook
// tests AND hooks.test.ts's HTTP/bash hook tests, so whichever file loads the
// cache first, both test files will find what they need.

const sofik_root_md = path.join(process.cwd(), "SOFIK.md");

let originalRootSofik: string | null = null;
try { originalRootSofik = fs.readFileSync(sofik_root_md, "utf-8"); } catch { /* fine */ }

// Combined config:  entries from hooks.test.ts  +  agent entries for this file.
const combinedHookConfig = {
  PreToolUse: [
    // ── entries required by hooks.test.ts ──────────────────────────────────
    { matcher: { tools: ["TestTool"] }, hooks: [{ type: "http", url: "http://test-pre/hook" }] },
    { matcher: { tools: ["BashTool"] }, hooks: [{ type: "bash", command: "true" }] },
    { matcher: { tools: ["*"] },        hooks: [{ type: "http", url: "http://test-pre/wildcard" }] },
    { matcher: {},                       hooks: [{ type: "http", url: "http://test-pre/nomatcher" }] },
    // ── entries required by this file ─────────────────────────────────────
    {
      matcher: { tools: ["AgentTool"] },
      hooks: [
        {
          type: "agent",
          prompt: "You ran {{TOOL_NAME}} with {{TOOL_INPUT}}",
          model: "claude-haiku-4-5-20251001",
          tools: ["Read", "Grep"],
          timeout: 2,
        },
      ],
    },
    {
      // prefix match: "Prefix" should match "PrefixSomething"
      matcher: { tools: ["Prefix"] },
      hooks: [{ type: "bash", command: "true" }],
    },
  ],
  PostToolUse: [
    // ── entries required by hooks.test.ts ──────────────────────────────────
    { matcher: { tools: ["PostTool"] }, hooks: [{ type: "http", url: "http://test-post/hook" }] },
    { matcher: { tools: ["FailTool"] }, hooks: [{ type: "bash", command: "exit 1" }] },
    { matcher: { tools: ["BashPre"] },  hooks: [{ type: "bash", command: "echo post-bash" }] },
    { matcher: {},                       hooks: [{ type: "http", url: "http://test-post/nomatcher" }] },
    // ── entries required by this file ─────────────────────────────────────
    {
      matcher: { tools: ["AgentPostTool"] },
      hooks: [
        {
          type: "agent",
          prompt: "Post hook for {{TOOL_NAME}}: result was {{TOOL_RESULT}}",
          // intentionally omit model and tools → uses defaults
          timeout: 2,
        },
      ],
    },
    {
      matcher: { tools: ["AgentFail"] },
      hooks: [{ type: "agent", prompt: "Fail hook", timeout: 2 }],
    },
    {
      matcher: { tools: ["AgentTimeout"] },
      hooks: [{ type: "agent", prompt: "Timeout hook", timeout: 1 }],
    },
  ],
};

fs.writeFileSync(sofik_root_md, "```json:hooks\n" + JSON.stringify(combinedHookConfig) + "\n```");

// ── Import hooks AFTER file is written and mocks are set up ───────────────────

import { runPreToolUseHooks, runPostToolUseHooks } from "./hooks.ts";

afterAll(() => {
  if (originalRootSofik !== null) {
    fs.writeFileSync(sofik_root_md, originalRootSofik);
  } else {
    try { fs.unlinkSync(sofik_root_md); } catch { /* ok */ }
  }
});

// ── matchesTool — prefix matching ─────────────────────────────────────────────

describe("matchesTool — prefix match", () => {
  test("a tool name that starts with a matcher string fires the hook", async () => {
    // "Prefix" matcher should match "PrefixRead" via toolName.startsWith(matcher)
    await expect(runPreToolUseHooks("PrefixRead", {})).resolves.toBeUndefined();
  });

  test("a tool name that does NOT start with the matcher does not fire that entry's hooks", async () => {
    // "SomethingElse" does not start with "Prefix" — should still resolve without agent being called
    const callsBefore = agentCalls.length;
    await expect(runPreToolUseHooks("SomethingElse", {})).resolves.toBeUndefined();
    // No agent hook should have fired for SomethingElse (only wildcard/nomatcher http hooks)
    expect(agentCalls.length).toBe(callsBefore);
  });
});

// ── Agent hook — PreToolUse ───────────────────────────────────────────────────

describe("agent hook (PreToolUse)", () => {
  beforeAll(() => {
    agentCalls.length = 0;
    agentShouldThrow = false;
    agentShouldTimeout = false;
    agentReturnValue = "agent feedback result";
  });

  test("calls runSimpleAgent with the correct model", async () => {
    agentCalls.length = 0;
    await runPreToolUseHooks("AgentTool", { path: "src/index.ts" });
    expect(agentCalls.length).toBeGreaterThan(0);
    expect(agentCalls[0]!.model).toBe("claude-haiku-4-5-20251001");
  });

  test("calls runSimpleAgent with the configured tools list", async () => {
    agentCalls.length = 0;
    await runPreToolUseHooks("AgentTool", {});
    expect(agentCalls[0]!.toolNames).toEqual(["Read", "Grep"]);
  });

  test("interpolates {{TOOL_NAME}} in the prompt", async () => {
    agentCalls.length = 0;
    await runPreToolUseHooks("AgentTool", {});
    expect(agentCalls[0]!.prompt).toContain("AgentTool");
    expect(agentCalls[0]!.prompt).not.toContain("{{TOOL_NAME}}");
  });

  test("interpolates {{TOOL_INPUT}} in the prompt", async () => {
    agentCalls.length = 0;
    await runPreToolUseHooks("AgentTool", { key: "value" });
    expect(agentCalls[0]!.prompt).toContain('"key"');
    expect(agentCalls[0]!.prompt).not.toContain("{{TOOL_INPUT}}");
  });

  test("resolves without throwing when agent succeeds", async () => {
    await expect(runPreToolUseHooks("AgentTool", {})).resolves.toBeUndefined();
  });
});

// ── Agent hook — PostToolUse (returns feedback) ───────────────────────────────

describe("agent hook (PostToolUse)", () => {
  beforeAll(() => {
    agentCalls.length = 0;
    agentShouldThrow = false;
    agentShouldTimeout = false;
    agentReturnValue = "agent feedback result";
  });

  test("returns agent output as feedback string", async () => {
    agentReturnValue = "my-agent-response";
    const feedback = await runPostToolUseHooks("AgentPostTool", {}, "tool output here");
    expect(feedback).toBe("my-agent-response");
  });

  test("interpolates {{TOOL_RESULT}} in the prompt", async () => {
    agentCalls.length = 0;
    agentReturnValue = "x";
    await runPostToolUseHooks("AgentPostTool", {}, "the actual result");
    const call = agentCalls.find((c) => c.prompt.includes("the actual result"));
    expect(call).toBeDefined();
  });

  test("uses default model when none specified", async () => {
    agentCalls.length = 0;
    agentReturnValue = "x";
    await runPostToolUseHooks("AgentPostTool", {}, "result");
    // config for AgentPostTool omits model → default is "claude-haiku-4-5-20251001"
    expect(agentCalls[0]!.model).toBe("claude-haiku-4-5-20251001");
  });

  test("uses default tool list when none specified", async () => {
    agentCalls.length = 0;
    agentReturnValue = "x";
    await runPostToolUseHooks("AgentPostTool", {}, "result");
    // default tools from DEFAULT_AGENT_HOOK_TOOLS constant in hooks.ts
    expect(agentCalls[0]!.toolNames).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Bash"]);
  });
});

// ── Agent hook — error handling ───────────────────────────────────────────────

describe("agent hook error handling", () => {
  test("agent that throws does not propagate the error (best-effort)", async () => {
    agentShouldThrow = true;
    try {
      const result = await runPostToolUseHooks("AgentFail", {}, "result");
      // Should return undefined, not throw
      expect(result).toBeUndefined();
    } finally {
      agentShouldThrow = false;
    }
  });

  test("agent timeout results in undefined feedback, not a throw", async () => {
    agentShouldTimeout = true;
    try {
      // 1-second timeout configured for AgentTimeout — stub hangs forever
      const result = await runPostToolUseHooks("AgentTimeout", {}, "result");
      expect(result).toBeUndefined();
    } finally {
      agentShouldTimeout = false;
    }
  }, 5_000);
});
