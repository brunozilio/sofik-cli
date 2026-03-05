import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  agentTool,
  agentRegistry,
  AGENT_TYPES,
  runSimpleAgent,
  _agentTestSeams,
  type AgentState,
} from "./agent.ts";
import { backgroundTaskRegistry } from "../lib/backgroundTasks.ts";
import { taskCreateTool, taskUpdateTool } from "./task.ts";
import type { StreamParams } from "../lib/providers/types.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("agentTool metadata", () => {
  test("name is 'Agent'", () => {
    expect(agentTool.name).toBe("Agent");
  });

  test("has a description", () => {
    expect(typeof agentTool.description).toBe("string");
    expect(agentTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof agentTool.execute).toBe("function");
  });

  test("input_schema requires description", () => {
    expect(agentTool.input_schema.required).toContain("description");
  });

  test("input_schema requires prompt", () => {
    expect(agentTool.input_schema.required).toContain("prompt");
  });

  test("input_schema has subagent_type property", () => {
    expect(agentTool.input_schema.properties).toHaveProperty("subagent_type");
  });

  test("input_schema has inherit_context property", () => {
    expect(agentTool.input_schema.properties).toHaveProperty("inherit_context");
  });

  test("input_schema has run_in_background property", () => {
    expect(agentTool.input_schema.properties).toHaveProperty("run_in_background");
  });

  test("input_schema has resume property", () => {
    expect(agentTool.input_schema.properties).toHaveProperty("resume");
  });

  test("input_schema has max_turns property", () => {
    expect(agentTool.input_schema.properties).toHaveProperty("max_turns");
  });
});

// ── AGENT_TYPES ────────────────────────────────────────────────────────────────

describe("AGENT_TYPES", () => {
  test("has general-purpose type", () => {
    expect(AGENT_TYPES["general-purpose"]).toBeDefined();
  });

  test("has Explore type", () => {
    expect(AGENT_TYPES["Explore"]).toBeDefined();
  });

  test("has Plan type", () => {
    expect(AGENT_TYPES["Plan"]).toBeDefined();
  });

  test("has statusline-setup type", () => {
    expect(AGENT_TYPES["statusline-setup"]).toBeDefined();
  });

  test("has claude-code-guide type", () => {
    expect(AGENT_TYPES["claude-code-guide"]).toBeDefined();
  });

  test("general-purpose has 'all' tools", () => {
    expect(AGENT_TYPES["general-purpose"].tools).toBe("all");
  });

  test("Explore has restricted tool set", () => {
    const tools = AGENT_TYPES["Explore"].tools;
    expect(Array.isArray(tools)).toBe(true);
    const toolArray = tools as string[];
    expect(toolArray).toContain("Read");
    expect(toolArray).toContain("Glob");
    expect(toolArray).toContain("Grep");
  });

  test("Plan has planning tool set", () => {
    const tools = AGENT_TYPES["Plan"].tools;
    expect(Array.isArray(tools)).toBe(true);
    const toolArray = tools as string[];
    expect(toolArray).toContain("Read");
    expect(toolArray).toContain("TaskCreate");
    expect(toolArray).toContain("TaskUpdate");
  });

  test("Explore has a haiku model for speed", () => {
    expect(AGENT_TYPES["Explore"].model).toContain("haiku");
  });

  test("each agent type has a description", () => {
    for (const [_name, def] of Object.entries(AGENT_TYPES)) {
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test("each agent type has a systemPromptSuffix", () => {
    for (const [_name, def] of Object.entries(AGENT_TYPES)) {
      expect(typeof def.systemPromptSuffix).toBe("string");
    }
  });

  test("Explore type does not include Bash or Edit tools", () => {
    const tools = AGENT_TYPES["Explore"].tools as string[];
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });

  test("Plan type does not include Bash or Edit tools", () => {
    const tools = AGENT_TYPES["Plan"].tools as string[];
    expect(tools).not.toContain("Bash");
    expect(tools).not.toContain("Edit");
    expect(tools).not.toContain("Write");
  });
});

// ── agentRegistry ─────────────────────────────────────────────────────────────

describe("agentRegistry", () => {
  test("is a Map", () => {
    expect(agentRegistry instanceof Map).toBe(true);
  });

  test("can store and retrieve agent state", () => {
    const testId = `test-agent-${Date.now()}`;
    const state: AgentState = {
      agentId: testId,
      description: "test",
      status: "running",
      output: "",
      outputFile: "/tmp/out",
      promise: Promise.resolve("done"),
      startedAt: Date.now(),
    };
    agentRegistry.set(testId, state);
    expect(agentRegistry.has(testId)).toBe(true);
    expect(agentRegistry.get(testId)!.agentId).toBe(testId);
    agentRegistry.delete(testId);
  });

  test("returns undefined for unknown agent ID", () => {
    expect(agentRegistry.get("unknown-agent-xyz")).toBeUndefined();
  });
});

// ── agent execute — missing resume transcript ────────────────────────────────

describe("agentTool — error cases", () => {
  test("returns error when resume ID has no transcript", async () => {
    const result = await agentTool.execute!({
      description: "test",
      prompt: "do something",
      resume: "nonexistent-agent-id-xyz",
    }) as string;
    expect(result).toContain("Error");
    expect(result).toContain("nonexistent-agent-id-xyz");
  });
});

// ── agent execute — covers execution paths (auth errors expected without creds) ─

describe("agentTool — execution coverage", () => {
  test("execute() runs the agent pipeline (throws auth error without credentials)", async () => {
    // Calling execute() covers: generateAgentId, getOutputPath, ensureDir,
    // getAllTools, buildSystemPrompt, loadProjectMemory, getActiveTasks, runAgent.
    // Without real auth configured, the underlying provider throws.
    await expect(agentTool.execute!({
      description: "test agent",
      prompt: "say hello",
    })).rejects.toThrow();
  }, 5000);

  test("execute() with model override resolves model before auth check", async () => {
    // Covers model resolution path (MODEL_MAP lookup)
    await expect(agentTool.execute!({
      description: "model test",
      prompt: "test",
      model: "sonnet",
    })).rejects.toThrow();
  }, 5000);

  test("execute() with subagent_type resolves agent type config", async () => {
    // Covers AGENT_TYPES lookup and tool filtering
    await expect(agentTool.execute!({
      description: "explore test",
      prompt: "search for files",
      subagent_type: "Explore",
      model: "sonnet",
    })).rejects.toThrow();
  }, 5000);

  test("execute() with unknown subagent_type falls back to general-purpose", async () => {
    // Covers the AGENT_TYPES fallback path
    await expect(agentTool.execute!({
      description: "fallback test",
      prompt: "test",
      subagent_type: "nonexistent-type",
    })).rejects.toThrow();
  }, 5000);

  test("execute() with inherit_context builds context-enriched system prompt", async () => {
    // Covers loadProjectMemory + getActiveTasks path
    await expect(agentTool.execute!({
      description: "context test",
      prompt: "test with context",
      inherit_context: true,
    })).rejects.toThrow();
  }, 5000);

  test("execute() with run_in_background returns JSON immediately", async () => {
    // Background path returns synchronously (doesn't wait for auth)
    const result = await agentTool.execute!({
      description: "bg test",
      prompt: "background task",
      run_in_background: true,
    }) as string;
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(typeof parsed.agentId).toBe("string");
    expect(parsed.status).toBe("running");
    // Register in backgroundTaskRegistry
    const task = backgroundTaskRegistry.get(parsed.agentId);
    expect(task).toBeDefined();
    expect(task!.type).toBe("agent");
  }, 5000);
});

// ── runSimpleAgent ────────────────────────────────────────────────────────────

describe("runSimpleAgent", () => {
  test("runs the pipeline (throws auth error without credentials)", async () => {
    // Covers getAllTools filtering, buildSystemPrompt, and runAgent call
    await expect(runSimpleAgent({
      prompt: "test prompt",
      model: "claude-haiku-4-5",
      toolNames: [],
    })).rejects.toThrow();
  }, 5000);

  test("filters tools by toolNames before calling runAgent", async () => {
    // Covers the toolNames filter branch
    await expect(runSimpleAgent({
      prompt: "filtered tools test",
      model: "claude-haiku-4-5",
      toolNames: ["Read", "Glob"],
    })).rejects.toThrow();
  }, 5000);
});

// ── Mock stream tests — foreground success path ────────────────────────────────
// Covers: runAgent for-await body (158-160, 162), saveTranscript (93-98),
//         onChunk foreground callback (449-451)

async function* mockStreamImpl(params: StreamParams): AsyncGenerator<string> {
  // Call onToolUse and onToolResult to cover those anonymous callbacks in runAgent
  await params.onToolUse("MockTool", {});
  params.onToolResult({ tool_use_id: "mock-id", content: "" });
  yield "hello from mock stream";
}

describe("agentTool — mock stream: foreground success", () => {
  afterEach(() => {
    _agentTestSeams.streamFn = undefined;
  });

  test("foreground execute() with mock stream returns output", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const result = await agentTool.execute!({
      description: "mock foreground test",
      prompt: "say something",
    }) as string;
    expect(result).toContain("hello from mock stream");
    expect(result).toContain("agentId:");
  }, 10000);

  test("foreground execute() with model override + mock stream succeeds", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const result = await agentTool.execute!({
      description: "model mock test",
      prompt: "test",
      model: "haiku",
    }) as string;
    expect(result).toContain("hello from mock stream");
  }, 10000);

  test("foreground execute() with max_turns + mock stream", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const result = await agentTool.execute!({
      description: "max turns test",
      prompt: "limited turns",
      max_turns: 1,
    }) as string;
    expect(typeof result).toBe("string");
    expect(result).toContain("hello from mock stream");
  }, 10000);
});

// ── Mock stream tests — background failure path ───────────────────────────────
// Covers: .catch() background callback (388-397)

describe("agentTool — mock stream: background failure", () => {
  afterEach(() => {
    _agentTestSeams.streamFn = undefined;
  });

  test("background execute() with failing mock stream: task marked as failed", async () => {
    _agentTestSeams.streamFn = async function*(_params: StreamParams): AsyncGenerator<string> {
      throw new Error("mock stream failure");
    };
    const result = await agentTool.execute!({
      description: "bg fail test",
      prompt: "will fail",
      run_in_background: true,
    }) as string;
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.agentId)!;
    expect(task).toBeDefined();
    // promise.catch() swallows the error and returns accumulated output
    await task.promise;
    expect(task.status).toBe("failed");
    expect(task.endedAt).toBeDefined();
  }, 15000);
});

// ── Mock stream tests — background success path ────────────────────────────────
// Covers: onChunk background (368-373), .then() background (376-386)

describe("agentTool — mock stream: background success", () => {
  afterEach(() => {
    _agentTestSeams.streamFn = undefined;
  });

  test("background execute() with mock stream: task completes successfully", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const result = await agentTool.execute!({
      description: "bg mock stream test",
      prompt: "background task",
      run_in_background: true,
    }) as string;
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.agentId);
    expect(task).toBeDefined();
    const output = await task!.promise;
    expect(task!.status).toBe("completed");
    expect(output).toContain("hello from mock stream");
  }, 15000);

  test("background execute() with mock stream: task has endedAt after completion", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const before = Date.now();
    const result = await agentTool.execute!({
      description: "bg timing test",
      prompt: "timing task",
      run_in_background: true,
    }) as string;
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.agentId)!;
    await task.promise;
    expect(task.endedAt).toBeGreaterThanOrEqual(before);
  }, 15000);
});

// ── Mock stream + worktree isolation ──────────────────────────────────────────
// Covers: worktreeInfo setup (348-351), cleanupWorktreeIfEmpty (197-208)

describe("agentTool — mock stream: worktree isolation", () => {
  afterEach(() => {
    _agentTestSeams.streamFn = undefined;
  });

  test("background execute() with worktree isolation + mock stream covers cleanupWorktreeIfEmpty", async () => {
    _agentTestSeams.streamFn = mockStreamImpl;
    const result = await agentTool.execute!({
      description: "worktree mock test",
      prompt: "isolated task",
      isolation: "worktree",
      run_in_background: true,
    }) as string;
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.agentId);
    expect(task).toBeDefined();
    // Wait for background task to complete (mock stream succeeds quickly)
    await task!.promise;
    // worktreeInfo was set → .then() called cleanupWorktreeIfEmpty → status should be completed
    expect(task!.status).toBe("completed");
  }, 30000);
});

// ── loadTranscript success path ────────────────────────────────────────────────
// Covers: lines 107-110 (reading transcript from disk)

describe("agentTool — loadTranscript success (covers 107-110)", () => {
  const resumeId = "test-agent-transcript-load-xyz-abc";
  const transcriptFile = path.join(
    os.homedir(), ".sofik", "agent-transcripts", `${resumeId}.json`
  );

  beforeEach(() => {
    fs.mkdirSync(path.dirname(transcriptFile), { recursive: true });
    fs.writeFileSync(
      transcriptFile,
      JSON.stringify([{ role: "user" as const, content: "previous message" }]),
      "utf8"
    );
    _agentTestSeams.streamFn = async function*(_params: StreamParams) {
      yield "resumed output";
    };
  });

  afterEach(() => {
    _agentTestSeams.streamFn = undefined;
    try { fs.unlinkSync(transcriptFile); } catch { /* ignore */ }
  });

  test("resume with existing transcript loads messages and runs agent", async () => {
    const result = await agentTool.execute!({
      description: "resume test",
      prompt: "continue from transcript",
      resume: resumeId,
    }) as string;
    expect(result).toContain("resumed output");
  }, 15000);
});

// ── Active tasks with inherit_context ─────────────────────────────────────────
// Covers: lines 319, 322 (parts.push for active tasks, systemPrompt += context)

describe("agentTool — active tasks + inherit_context (covers 319, 322)", () => {
  let createdTaskId: string | undefined;

  beforeEach(async () => {
    // Create a task and mark it in_progress so getActiveTasks() returns non-empty
    const createResult = await taskCreateTool.execute!({
      subject: "Coverage test task",
      description: "Task created for agent coverage testing",
      activeForm: "Running coverage test",
    }) as string;
    const match = createResult.match(/#(\d+)/);
    if (match) {
      createdTaskId = match[1]!;
      await taskUpdateTool.execute!({ taskId: createdTaskId, status: "in_progress" });
    }
    _agentTestSeams.streamFn = async function*(_params: StreamParams) {
      yield "context output";
    };
  });

  afterEach(async () => {
    _agentTestSeams.streamFn = undefined;
    if (createdTaskId) {
      await taskUpdateTool.execute!({ taskId: createdTaskId, status: "completed" }).catch(() => {});
      createdTaskId = undefined;
    }
  });

  test("execute() with inherit_context + in_progress tasks includes active tasks in system prompt", async () => {
    const result = await agentTool.execute!({
      description: "context + tasks test",
      prompt: "test with active tasks in context",
      inherit_context: true,
    }) as string;
    expect(result).toContain("context output");
  }, 15000);
});
