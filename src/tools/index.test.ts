import { test, expect, describe, beforeEach } from "bun:test";
import { getAllTools, getTool, registerTool } from "./index.ts";
import type { ToolDefinition } from "../lib/types.ts";

// ── getAllTools ────────────────────────────────────────────────────────────────

describe("getAllTools", () => {
  test("returns an array", () => {
    const tools = getAllTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  test("returns at least 20 tools", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(20);
  });

  test("contains Read tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Read")).toBe(true);
  });

  test("contains Write tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Write")).toBe(true);
  });

  test("contains Edit tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Edit")).toBe(true);
  });

  test("contains MultiEdit tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "MultiEdit")).toBe(true);
  });

  test("contains Bash tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Bash")).toBe(true);
  });

  test("contains Glob tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Glob")).toBe(true);
  });

  test("contains Grep tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Grep")).toBe(true);
  });

  test("contains Agent tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Agent")).toBe(true);
  });

  test("contains TaskOutput tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "TaskOutput")).toBe(true);
  });

  test("contains WebFetch tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "WebFetch")).toBe(true);
  });

  test("contains WebSearch tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "WebSearch")).toBe(true);
  });

  test("contains NotebookEdit tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "NotebookEdit")).toBe(true);
  });

  test("contains NotebookRead tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "NotebookRead")).toBe(true);
  });

  test("contains TaskCreate tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "TaskCreate")).toBe(true);
  });

  test("contains TaskUpdate tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "TaskUpdate")).toBe(true);
  });

  test("contains TaskGet tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "TaskGet")).toBe(true);
  });

  test("contains TaskList tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "TaskList")).toBe(true);
  });

  test("contains Skill tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Skill")).toBe(true);
  });

  test("contains EnterPlanMode tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "EnterPlanMode")).toBe(true);
  });

  test("contains ExitPlanMode tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "ExitPlanMode")).toBe(true);
  });

  test("contains EnterWorktree tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "EnterWorktree")).toBe(true);
  });

  test("contains UpdateMemory tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "UpdateMemory")).toBe(true);
  });

  test("contains AppendMemory tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "AppendMemory")).toBe(true);
  });

  test("contains AskUserQuestion tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "AskUserQuestion")).toBe(true);
  });

  test("contains IntegrationAction tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "IntegrationAction")).toBe(true);
  });

  test("contains IntegrationList tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "IntegrationList")).toBe(true);
  });

  test("contains Git tool", () => {
    const tools = getAllTools();
    expect(tools.some((t) => t.name === "Git")).toBe(true);
  });

  test("all tools have a name property", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  test("all tools have a description property", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  test("all tools have an input_schema property", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(tool.input_schema).toBeDefined();
      expect(typeof tool.input_schema).toBe("object");
    }
  });

  test("all tools have an execute function", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(typeof tool.execute).toBe("function");
    }
  });

  test("tool names are unique", () => {
    const tools = getAllTools();
    const names = tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

// ── getTool ────────────────────────────────────────────────────────────────────

describe("getTool", () => {
  test("finds Read tool by name", () => {
    const tool = getTool("Read");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Read");
  });

  test("finds Write tool by name", () => {
    const tool = getTool("Write");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Write");
  });

  test("finds Bash tool by name", () => {
    const tool = getTool("Bash");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Bash");
  });

  test("finds Git tool by name", () => {
    const tool = getTool("Git");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("Git");
  });

  test("returns undefined for unknown tool name", () => {
    const tool = getTool("NonExistentTool_XYZ");
    expect(tool).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const tool = getTool("");
    expect(tool).toBeUndefined();
  });

  test("is case-sensitive", () => {
    // Tool names are capitalized
    const tool = getTool("read"); // lowercase
    expect(tool).toBeUndefined();
  });
});

// ── registerTool ───────────────────────────────────────────────────────────────

describe("registerTool", () => {
  const UNIQUE_NAME = `TestTool_${Date.now()}`;

  const testTool: ToolDefinition = {
    name: UNIQUE_NAME,
    description: "A test tool for unit tests",
    input_schema: {
      type: "object",
      properties: { input: { type: "string", description: "test" } },
      required: [],
    },
    async execute() {
      return "test result";
    },
  };

  test("registers a new tool", () => {
    registerTool(testTool);
    const found = getTool(UNIQUE_NAME);
    expect(found).toBeDefined();
    expect(found!.name).toBe(UNIQUE_NAME);
  });

  test("registered tool appears in getAllTools", () => {
    registerTool(testTool);
    const tools = getAllTools();
    expect(tools.some((t) => t.name === UNIQUE_NAME)).toBe(true);
  });

  test("registering a tool with existing name replaces it", () => {
    const updatedTool: ToolDefinition = {
      ...testTool,
      description: "Updated description",
    };
    registerTool(updatedTool);
    const found = getTool(UNIQUE_NAME);
    expect(found!.description).toBe("Updated description");
  });

  test("does not create duplicates when registering same name twice", () => {
    const before = getAllTools().filter((t) => t.name === UNIQUE_NAME).length;
    registerTool(testTool);
    const after = getAllTools().filter((t) => t.name === UNIQUE_NAME).length;
    expect(after).toBe(before);
  });

  test("registered tool execute function works", async () => {
    registerTool(testTool);
    const found = getTool(UNIQUE_NAME);
    const result = await found!.execute!({});
    expect(result).toBe("test result");
  });
});
