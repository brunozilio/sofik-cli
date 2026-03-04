import { test, expect, describe } from "bun:test";

import { bashTool } from "./bash.ts";

async function bash(input: Record<string, unknown>): Promise<string> {
  return bashTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("bashTool metadata", () => {
  test("name is 'Bash'", () => {
    expect(bashTool.name).toBe("Bash");
  });

  test("has a description", () => {
    expect(typeof bashTool.description).toBe("string");
    expect(bashTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof bashTool.execute).toBe("function");
  });

  test("input_schema requires command", () => {
    expect(bashTool.input_schema.required).toContain("command");
  });

  test("input_schema has timeout property", () => {
    expect(bashTool.input_schema.properties).toHaveProperty("timeout");
  });

  test("input_schema has description property", () => {
    expect(bashTool.input_schema.properties).toHaveProperty("description");
  });
});

// ── Basic execution ────────────────────────────────────────────────────────────

describe("bashTool — basic execution", () => {
  test("executes echo and returns output", async () => {
    const result = await bash({ command: "echo hello" });
    expect(result).toContain("hello");
  }, 10000);

  test("executes simple arithmetic", async () => {
    const result = await bash({ command: "echo $((2 + 3))" });
    expect(result).toContain("5");
  }, 10000);

  test("returns stdout from a command", async () => {
    const result = await bash({ command: "printf 'output line\\n'" });
    expect(result).toContain("output line");
  }, 10000);

  test("returns empty-output marker when command produces no output", async () => {
    const result = await bash({ command: "true" });
    expect(result).toContain("sem saída");
  }, 10000);

  test("captures stderr output", async () => {
    const result = await bash({ command: "echo 'err text' >&2" });
    expect(result).toContain("err text");
  }, 10000);

  test("accepts optional description parameter", async () => {
    const result = await bash({ command: "echo described", description: "Test command" });
    expect(result).toContain("described");
  }, 10000);

  test("runs multiple commands with &&", async () => {
    const result = await bash({ command: "echo first && echo second" });
    expect(result).toContain("first");
    expect(result).toContain("second");
  }, 10000);
});

// ── Exit codes ─────────────────────────────────────────────────────────────────

describe("bashTool — exit codes", () => {
  test("includes exit code in output when non-zero", async () => {
    const result = await bash({ command: "exit 1" });
    expect(result).toContain("Código de saída: 1");
  }, 10000);

  test("includes exit code 2 in output", async () => {
    const result = await bash({ command: "exit 2" });
    expect(result).toContain("Código de saída: 2");
  }, 10000);

  test("does NOT include exit code when command succeeds", async () => {
    const result = await bash({ command: "echo ok" });
    expect(result).not.toContain("Código de saída:");
  }, 10000);

  test("failed command includes stdout before the exit code", async () => {
    const result = await bash({ command: "echo output; exit 1" });
    expect(result).toContain("output");
    expect(result).toContain("Código de saída: 1");
  }, 10000);
});

// ── Truncation ─────────────────────────────────────────────────────────────────

describe("bashTool — truncation", () => {
  test("truncates output longer than 30000 chars", async () => {
    // Generate ~32000 chars of output
    const result = await bash({
      command: "python3 -c \"print('x' * 32000)\" 2>/dev/null || printf '%0.s#' {1..32001}",
    });
    if (result.length > 30000) {
      expect(result).toContain("chars truncated");
    }
    // If command failed, it should still be a string
    expect(typeof result).toBe("string");
  }, 15000);
});

// ── Timeout ────────────────────────────────────────────────────────────────────

describe("bashTool — timeout", () => {
  test("timeout causes command to be killed and returns timeout message", async () => {
    // Use a busy loop in bash itself (no child process) to avoid orphan pipe issues
    const result = await bash({ command: "while true; do :; done", timeout: 300 });
    expect(result).toContain("expirou");
  }, 15000);

  test("short timeout terminates the command", async () => {
    const start = Date.now();
    const result = await bash({ command: "while true; do :; done", timeout: 300 });
    const elapsed = Date.now() - start;
    // Should complete well before the test timeout (15s) — the infinite loop is killed
    expect(elapsed).toBeLessThan(10000);
    expect(typeof result).toBe("string");
  }, 15000);
});

// ── CWD tracking ──────────────────────────────────────────────────────────────

describe("bashTool — CWD tracking", () => {
  test("cd changes the working directory for subsequent commands", async () => {
    await bash({ command: "cd /tmp" });
    const result = await bash({ command: "pwd" });
    expect(result).toContain("/tmp");
  }, 10000);

  test("CWD marker is stripped from output", async () => {
    const result = await bash({ command: "echo hello" });
    expect(result).not.toContain("__CWD__");
  }, 10000);
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("bashTool — error handling", () => {
  test("command not found returns an error message", async () => {
    const result = await bash({ command: "this_command_does_not_exist_xyz_abc" });
    // Either "not found" in stderr or exit code
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 10000);
});
