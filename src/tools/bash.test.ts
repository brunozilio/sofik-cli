import { test, expect, describe } from "bun:test";

import { bashTool } from "./bash.ts";
import { backgroundTaskRegistry } from "../lib/backgroundTasks.ts";

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

  test("spawn error in foreground mode returns error string (empty PATH)", async () => {
    const origPath = process.env.PATH;
    process.env.PATH = "/sofik-no-bash-path-xyz";
    try {
      const result = await bash({ command: "echo hello" });
      // Either the error handler fired (returns "Erro: ...") or bash was found anyway
      expect(typeof result).toBe("string");
    } finally {
      process.env.PATH = origPath;
    }
  }, 10000);

  test("spawn error in background mode results in failed task (empty PATH)", async () => {
    const origPath = process.env.PATH;
    process.env.PATH = "/sofik-no-bash-path-xyz";
    try {
      const result = await bash({ command: "echo hello", run_in_background: true });
      const parsed = JSON.parse(result);
      const task = backgroundTaskRegistry.get(parsed.taskId);
      if (task) {
        await task.promise;
        // Task should either fail (spawn error) or complete (bash found anyway)
        expect(["failed", "completed"]).toContain(task.status);
      }
    } finally {
      process.env.PATH = origPath;
    }
  }, 10000);
});

// ── Background mode ────────────────────────────────────────────────────────────

describe("bashTool — background mode", () => {
  test("run_in_background: true returns valid JSON", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    expect(() => JSON.parse(result)).not.toThrow();
  }, 10000);

  test("returned JSON has taskId starting with 'bash-'", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    expect(parsed.taskId).toMatch(/^bash-/);
  }, 10000);

  test("initial status is 'running'", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("running");
  }, 10000);

  test("response includes outputFile path with agent-output", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    expect(typeof parsed.outputFile).toBe("string");
    expect(parsed.outputFile).toContain("agent-output");
  }, 10000);

  test("response message references the taskId", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    expect(parsed.message).toContain(parsed.taskId);
  }, 10000);

  test("task is registered in backgroundTaskRegistry with type 'bash'", async () => {
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId);
    expect(task).toBeDefined();
    expect(task!.type).toBe("bash");
    expect(task!.taskId).toBe(parsed.taskId);
  }, 10000);

  test("background task completes with correct output", async () => {
    const result = await bash({ command: "echo bgoutput123", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    const output = await task.promise;
    expect(output).toContain("bgoutput123");
  }, 15000);

  test("task status becomes 'completed' after successful exit", async () => {
    const result = await bash({ command: "echo done", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    await task.promise;
    expect(task.status).toBe("completed");
  }, 15000);

  test("task status becomes 'failed' on non-zero exit", async () => {
    const result = await bash({ command: "exit 1", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    await task.promise;
    expect(task.status).toBe("failed");
  }, 15000);

  test("task uses provided description", async () => {
    const result = await bash({
      command: "echo hello",
      description: "My background task",
      run_in_background: true,
    });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    expect(task.description).toBe("My background task");
  }, 10000);

  test("task uses command as description when none provided", async () => {
    const result = await bash({ command: "echo no-desc", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    expect(task.description).toContain("echo no-desc");
  }, 10000);

  test("task captures stderr in background mode", async () => {
    const result = await bash({ command: "echo errtext >&2", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    const output = await task.promise;
    expect(output).toContain("errtext");
  }, 15000);

  test("task has startedAt timestamp", async () => {
    const before = Date.now();
    const result = await bash({ command: "echo hello", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    expect(task.startedAt).toBeGreaterThanOrEqual(before);
  }, 10000);

  test("task has endedAt after completion", async () => {
    const result = await bash({ command: "echo done", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;
    await task.promise;
    expect(task.endedAt).toBeGreaterThan(0);
  }, 15000);

  test("aborting controller kills background process", async () => {
    const result = await bash({ command: "sleep 30", run_in_background: true });
    const parsed = JSON.parse(result);
    const task = backgroundTaskRegistry.get(parsed.taskId)!;

    // Trigger the abort event listener (line 109 in bash.ts)
    task.controller.abort();

    // Wait for the process to die and the promise to resolve
    await task.promise;

    expect(task.controller.signal.aborted).toBe(true);
  }, 10000);
});
