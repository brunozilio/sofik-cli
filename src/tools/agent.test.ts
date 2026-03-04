import { test, expect, describe } from "bun:test";
import {
  agentTool,
  agentRegistry,
  AGENT_TYPES,
  type AgentState,
} from "./agent.ts";

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
    for (const [name, def] of Object.entries(AGENT_TYPES)) {
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test("each agent type has a systemPromptSuffix", () => {
    for (const [name, def] of Object.entries(AGENT_TYPES)) {
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
