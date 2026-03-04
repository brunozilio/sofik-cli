import { mock, test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Temp dir isolation (for loadCustomCommands — reads from process.cwd()/.sofik/commands/) ───

const TEST_DIR = mkdtempSync(join(tmpdir(), "sofik-commands-"));
const ORIG_CWD = process.cwd();
const COMMANDS_DIR = join(TEST_DIR, ".sofik", "commands");

let _mockTasks: Array<{ id: string; status: string; context: string }> = [];

// Do NOT mock ./skills.ts — it has its own test file and the mock would break
// systemPrompt.test.ts. Instead, we use real files in the temp dir.

mock.module("../integrations/connectors/index.ts", () => ({
  getAllConnectors: () => [],
  getAllProviders: () => [],
}));

mock.module("./models.ts", () => ({
  MODELS: {
    "claude-opus-4-6":   { contextWindow: 200000, maxOutput: 8096,  label: "Opus 4.6 (most capable)" },
    "claude-opus-4-5":   { contextWindow: 200000, maxOutput: 8096,  label: "Opus 4.5" },
    "claude-opus-4-1":   { contextWindow: 100000, maxOutput: 4096,  label: "Opus 4.1" },
    "claude-sonnet-4-6": { contextWindow: 200000, maxOutput: 8096,  label: "Sonnet 4.6 (fast + capable)" },
    "claude-sonnet-4-5": { contextWindow: 200000, maxOutput: 4096,  label: "Sonnet 4.5" },
    "claude-sonnet-4":   { contextWindow: 200000, maxOutput: 4096,  label: "Sonnet 4" },
    "claude-3-7-sonnet": { contextWindow: 32000,  maxOutput: 64000, label: "Sonnet 3.7" },
    "claude-3-5-sonnet": { contextWindow: 200000, maxOutput: 4096,  label: "Sonnet 3.5" },
    "claude-haiku-4-5":  { contextWindow: 100000, maxOutput: 4096,  label: "Haiku 4.5 (fast)" },
    "claude-3-5-haiku":  { contextWindow: 200000, maxOutput: 4096,  label: "Haiku 3.5" },
  },
  COPILOT_MODELS: {
    "gpt-4o":            { contextWindow: 128000, maxOutput: 16384,  label: "GPT-4o" },
    "gpt-4o-mini":       { contextWindow: 128000, maxOutput: 16384,  label: "GPT-4o mini (fast)" },
    "o1":                { contextWindow: 200000, maxOutput: 100000, label: "o1 (reasoning)" },
    "o3-mini":           { contextWindow: 200000, maxOutput: 100000, label: "o3-mini (fast reasoning)" },
    "claude-3.5-sonnet": { contextWindow: 200000, maxOutput: 8096,   label: "Claude Sonnet 3.5 (via Copilot)" },
    "claude-3.5-haiku":  { contextWindow: 200000, maxOutput: 8096,   label: "Claude Haiku 3.5 (via Copilot)" },
  },
  DEFAULT_MODEL: "claude-opus-4-6",
  getModel: (name: string) => ({ contextWindow: 200000, maxOutput: 8096, label: name }),
  listModels: () => "",
}));

mock.module("../db/queries/tasks.ts", () => ({
  listTasks: () => _mockTasks,
}));

import { BUILTIN_COMMANDS, SLASH_COMMANDS, getSlashCommands } from "./commands.ts";
import type { SlashCommand, SlashSubCommand, CommandArg } from "./commands.ts";

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(COMMANDS_DIR, { recursive: true });
  process.chdir(TEST_DIR);
});

afterAll(() => {
  process.chdir(ORIG_CWD);
});

beforeEach(() => {
  _mockTasks = [];
  // Clear all custom command files between tests
  if (existsSync(COMMANDS_DIR)) {
    for (const f of readdirSync(COMMANDS_DIR)) {
      unlinkSync(join(COMMANDS_DIR, f));
    }
  }
});

// ─── Helper: write real command files ────────────────────────────────────────

function withCustomCommands(commands: Array<{ name: string; description: string }>) {
  // Clear existing
  for (const f of readdirSync(COMMANDS_DIR)) {
    unlinkSync(join(COMMANDS_DIR, f));
  }
  // Write new
  for (const cmd of commands) {
    writeFileSync(join(COMMANDS_DIR, `${cmd.name}.md`), `# ${cmd.description}\nContent for ${cmd.name}.`, "utf-8");
  }
}

describe("BUILTIN_COMMANDS", () => {
  test("is an array", () => {
    expect(Array.isArray(BUILTIN_COMMANDS)).toBe(true);
    expect(BUILTIN_COMMANDS.length).toBeGreaterThan(0);
  });

  test("contains clear command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "clear");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBeTruthy();
  });

  test("contains commit command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "commit");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBeTruthy();
  });

  test("contains exit command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "exit");
    expect(cmd).toBeDefined();
  });

  test("contains login command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "login");
    expect(cmd).toBeDefined();
  });

  test("contains logout command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "logout");
    expect(cmd).toBeDefined();
  });

  test("contains model command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "model");
    expect(cmd).toBeDefined();
  });

  test("contains plan command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "plan");
    expect(cmd).toBeDefined();
  });

  test("contains sessions command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "sessions");
    expect(cmd).toBeDefined();
  });

  test("contains skill command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill");
    expect(cmd).toBeDefined();
  });

  test("contains mcp command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "mcp");
    expect(cmd).toBeDefined();
  });

  test("contains worktree command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "worktree");
    expect(cmd).toBeDefined();
  });

  test("contains tasks command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks");
    expect(cmd).toBeDefined();
  });

  test("contains integrations command", () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations");
    expect(cmd).toBeDefined();
  });

  test("each command has name and description", () => {
    for (const cmd of BUILTIN_COMMANDS) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  describe("model command", () => {
    test("has args array", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "model");
      expect(cmd!.args).toBeDefined();
      expect(Array.isArray(cmd!.args)).toBe(true);
    });

    test("args include mocked models", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "model")!;
      const args = cmd.args as CommandArg[];
      const modelNames = args.map((a) => a.name);
      expect(modelNames).toContain("claude-opus-4-6");
      expect(modelNames).toContain("claude-sonnet-4-6");
      expect(modelNames).toContain("gpt-4o");
    });

    test("args include model labels as descriptions", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "model")!;
      const args = cmd.args as CommandArg[];
      const opusArg = args.find((a) => a.name === "claude-opus-4-6");
      expect(opusArg!.description).toBe("Opus 4.6 (most capable)");
    });
  });

  describe("tasks command", () => {
    test("has subcommands", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      expect(Array.isArray(cmd.subcommands)).toBe(true);
      expect(cmd.subcommands!.length).toBeGreaterThan(0);
    });

    test("has list subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const list = cmd.subcommands!.find((s) => s.name === "list");
      expect(list).toBeDefined();
    });

    test("has create subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const create = cmd.subcommands!.find((s) => s.name === "create");
      expect(create).toBeDefined();
    });

    test("has run subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const run = cmd.subcommands!.find((s) => s.name === "run");
      expect(run).toBeDefined();
    });

    test("has cancel subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel");
      expect(cancel).toBeDefined();
    });

    test("cancel subcommand args is a function", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel")!;
      expect(typeof cancel.args).toBe("function");
    });

    test("cancel args function returns empty array when no tasks", () => {
      _mockTasks = [];
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel")!;
      const argsFn = cancel.args as () => CommandArg[];
      const result = argsFn();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    test("cancel args function returns pending/planning tasks", () => {
      _mockTasks = [
        { id: "abc12345def", status: "pending", context: "do something important" },
        { id: "xyz98765abc", status: "planning", context: "plan a big feature" },
        { id: "done111222", status: "done", context: "already finished" },
      ];
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel")!;
      const argsFn = cancel.args as () => CommandArg[];
      const result = argsFn();
      expect(result.length).toBe(2);
      expect(result[0]!.name).toBe("abc12345");
      expect(result[0]!.description).toBe("do something important");
      expect(result[1]!.name).toBe("xyz98765");
    });

    test("cancel args function filters out non-pending tasks", () => {
      _mockTasks = [
        { id: "running1", status: "running", context: "currently running" },
        { id: "failed11", status: "failed", context: "already failed" },
        { id: "pending1", status: "pending", context: "waiting to run" },
      ];
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel")!;
      const argsFn = cancel.args as () => CommandArg[];
      const result = argsFn();
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe("pending1");
    });

    test("cancel args function truncates context to 60 chars", () => {
      const longContext = "a".repeat(80);
      _mockTasks = [{ id: "longctx1abc", status: "pending", context: longContext }];
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const cancel = cmd.subcommands!.find((s) => s.name === "cancel")!;
      const argsFn = cancel.args as () => CommandArg[];
      const result = argsFn();
      expect(result[0]!.description!.length).toBe(60);
    });

    test("has clear subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "tasks")!;
      const clear = cmd.subcommands!.find((s) => s.name === "clear");
      expect(clear).toBeDefined();
    });
  });

  describe("skill command", () => {
    test("has subcommands", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill")!;
      expect(Array.isArray(cmd.subcommands)).toBe(true);
    });

    test("has list subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill")!;
      expect(cmd.subcommands!.find((s) => s.name === "list")).toBeDefined();
    });

    test("has new subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill")!;
      expect(cmd.subcommands!.find((s) => s.name === "new")).toBeDefined();
    });

    test("has edit subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill")!;
      expect(cmd.subcommands!.find((s) => s.name === "edit")).toBeDefined();
    });

    test("has remove subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "skill")!;
      expect(cmd.subcommands!.find((s) => s.name === "remove")).toBeDefined();
    });
  });

  describe("integrations command", () => {
    test("has subcommands", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations")!;
      expect(Array.isArray(cmd.subcommands)).toBe(true);
    });

    test("has connect subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations")!;
      expect(cmd.subcommands!.find((s) => s.name === "connect")).toBeDefined();
    });

    test("has disconnect subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations")!;
      expect(cmd.subcommands!.find((s) => s.name === "disconnect")).toBeDefined();
    });

    test("has status subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations")!;
      expect(cmd.subcommands!.find((s) => s.name === "status")).toBeDefined();
    });

    test("has list subcommand", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "integrations")!;
      expect(cmd.subcommands!.find((s) => s.name === "list")).toBeDefined();
    });
  });

  describe("sessions command", () => {
    test("has --search arg", () => {
      const cmd = BUILTIN_COMMANDS.find((c) => c.name === "sessions")!;
      const args = cmd.args as CommandArg[];
      expect(Array.isArray(args)).toBe(true);
      const searchArg = args.find((a) => a.name === "--search");
      expect(searchArg).toBeDefined();
    });
  });
});

describe("SLASH_COMMANDS", () => {
  test("is same reference as BUILTIN_COMMANDS", () => {
    expect(SLASH_COMMANDS).toBe(BUILTIN_COMMANDS);
  });
});

describe("getSlashCommands", () => {
  test("returns at least all builtin commands when no custom commands", () => {
    withCustomCommands([]);
    const result = getSlashCommands();
    expect(result.length).toBeGreaterThanOrEqual(BUILTIN_COMMANDS.length);
  });

  test("includes all builtin commands by name", () => {
    withCustomCommands([]);
    const result = getSlashCommands();
    const names = result.map((c) => c.name);
    for (const builtin of BUILTIN_COMMANDS) {
      expect(names).toContain(builtin.name);
    }
  });

  test("custom commands appear in result", () => {
    withCustomCommands([{ name: "my-custom", description: "A custom command" }]);
    const result = getSlashCommands();
    const custom = result.find((c) => c.name === "my-custom");
    expect(custom).toBeDefined();
    expect(custom!.description).toBe("A custom command");
    expect(custom!.isCustom).toBe(true);
  });

  test("custom commands have isCustom flag set to true", () => {
    withCustomCommands([
      { name: "custom-a", description: "Command A" },
      { name: "custom-b", description: "Command B" },
    ]);
    const result = getSlashCommands();
    const customA = result.find((c) => c.name === "custom-a")!;
    const customB = result.find((c) => c.name === "custom-b")!;
    expect(customA.isCustom).toBe(true);
    expect(customB.isCustom).toBe(true);
  });

  test("custom command overrides builtin with same name", () => {
    withCustomCommands([{ name: "clear", description: "My custom clear" }]);
    const result = getSlashCommands();
    const clearCmds = result.filter((c) => c.name === "clear");
    // Should only appear once
    expect(clearCmds.length).toBe(1);
    // Should be the custom version
    expect(clearCmds[0]!.isCustom).toBe(true);
    expect(clearCmds[0]!.description).toBe("My custom clear");
  });

  test("result contains no duplicate names", () => {
    withCustomCommands([]);
    const result = getSlashCommands();
    const names = result.map((c) => c.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  test("builtin commands not marked as custom", () => {
    withCustomCommands([]);
    const result = getSlashCommands();
    const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
    for (const cmd of result) {
      if (builtinNames.has(cmd.name)) {
        expect(cmd.isCustom).toBeUndefined();
      }
    }
  });

  test("multiple custom commands all appear", () => {
    withCustomCommands([
      { name: "cmd-one", description: "One" },
      { name: "cmd-two", description: "Two" },
      { name: "cmd-three", description: "Three" },
    ]);
    const result = getSlashCommands();
    expect(result.find((c) => c.name === "cmd-one")).toBeDefined();
    expect(result.find((c) => c.name === "cmd-two")).toBeDefined();
    expect(result.find((c) => c.name === "cmd-three")).toBeDefined();
  });
});
