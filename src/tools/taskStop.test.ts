import { test, expect, describe, beforeEach } from "bun:test";

import { taskStopTool } from "./taskStop.ts";
import { backgroundTaskRegistry, type BackgroundTask } from "../lib/backgroundTasks.ts";

function makeRunningTask(id: string): BackgroundTask {
  return {
    taskId: id,
    type: "bash",
    description: `task ${id}`,
    status: "running",
    partialOutput: "",
    outputFile: `/tmp/${id}.out`,
    promise: Promise.resolve("done"),
    controller: new AbortController(),
    startedAt: Date.now(),
  };
}

async function stopTask(input: Record<string, unknown>): Promise<string> {
  return taskStopTool.execute!(input) as Promise<string>;
}

// ── metadata ────────────────────────────────────────────────────────────────

describe("taskStopTool metadata", () => {
  test("name is 'TaskStop'", () => {
    expect(taskStopTool.name).toBe("TaskStop");
  });

  test("has a description", () => {
    expect(typeof taskStopTool.description).toBe("string");
    expect(taskStopTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof taskStopTool.execute).toBe("function");
  });

  test("requires task_id", () => {
    expect(taskStopTool.input_schema.required).toContain("task_id");
  });

  test("has task_id property in schema", () => {
    expect(taskStopTool.input_schema.properties).toHaveProperty("task_id");
  });
});

// ── execute: task not found ──────────────────────────────────────────────────

describe("taskStopTool — task not found", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("returns JSON with success: false when task id is unknown", async () => {
    const result = await stopTask({ task_id: "nonexistent-id" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  test("error message mentions the task id", async () => {
    const result = await stopTask({ task_id: "missing-task" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("missing-task");
  });

  test("error message mentions 'not found'", async () => {
    const result = await stopTask({ task_id: "ghost" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toMatch(/not found/i);
  });

  test("returns valid JSON string", async () => {
    const result = await stopTask({ task_id: "any-id" });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

// ── execute: task not running ────────────────────────────────────────────────

describe("taskStopTool — task not running", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("returns success: false when task status is completed", async () => {
    const task = makeRunningTask("t-completed");
    task.status = "completed";
    backgroundTaskRegistry.set("t-completed", task);

    const result = await stopTask({ task_id: "t-completed" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  test("returns success: false when task status is failed", async () => {
    const task = makeRunningTask("t-failed");
    task.status = "failed";
    backgroundTaskRegistry.set("t-failed", task);

    const result = await stopTask({ task_id: "t-failed" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  test("returns success: false when task status is stopped", async () => {
    const task = makeRunningTask("t-stopped");
    task.status = "stopped";
    backgroundTaskRegistry.set("t-stopped", task);

    const result = await stopTask({ task_id: "t-stopped" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  test("error message includes task id and current status", async () => {
    const task = makeRunningTask("t-done");
    task.status = "completed";
    backgroundTaskRegistry.set("t-done", task);

    const result = await stopTask({ task_id: "t-done" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("t-done");
    expect(parsed.error).toContain("completed");
  });
});

// ── execute: stop running task ───────────────────────────────────────────────

describe("taskStopTool — stop running task", () => {
  beforeEach(() => {
    backgroundTaskRegistry.clear();
  });

  test("returns success: true for a running task", async () => {
    const task = makeRunningTask("t-running");
    backgroundTaskRegistry.set("t-running", task);

    const result = await stopTask({ task_id: "t-running" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
  });

  test("sets task status to stopped", async () => {
    const task = makeRunningTask("t-set-stopped");
    backgroundTaskRegistry.set("t-set-stopped", task);

    await stopTask({ task_id: "t-set-stopped" });
    expect(task.status).toBe("stopped");
  });

  test("aborts the task controller", async () => {
    const task = makeRunningTask("t-abort");
    backgroundTaskRegistry.set("t-abort", task);

    await stopTask({ task_id: "t-abort" });
    expect(task.controller.signal.aborted).toBe(true);
  });

  test("response includes task_id", async () => {
    const task = makeRunningTask("t-id-check");
    backgroundTaskRegistry.set("t-id-check", task);

    const result = await stopTask({ task_id: "t-id-check" });
    const parsed = JSON.parse(result);
    expect(parsed.task_id).toBe("t-id-check");
  });

  test("response includes task description", async () => {
    const task = makeRunningTask("t-desc");
    task.description = "Build the project";
    backgroundTaskRegistry.set("t-desc", task);

    const result = await stopTask({ task_id: "t-desc" });
    const parsed = JSON.parse(result);
    expect(parsed.description).toBe("Build the project");
  });

  test("response message mentions the task description", async () => {
    const task = makeRunningTask("t-msg");
    task.description = "Run tests";
    backgroundTaskRegistry.set("t-msg", task);

    const result = await stopTask({ task_id: "t-msg" });
    const parsed = JSON.parse(result);
    expect(parsed.message).toContain("Run tests");
  });

  test("task remains in registry after stopping", async () => {
    const task = makeRunningTask("t-registry");
    backgroundTaskRegistry.set("t-registry", task);

    await stopTask({ task_id: "t-registry" });
    expect(backgroundTaskRegistry.has("t-registry")).toBe(true);
  });

  test("stops agent-type task correctly", async () => {
    const task = makeRunningTask("t-agent");
    task.type = "agent";
    task.description = "Run subagent";
    backgroundTaskRegistry.set("t-agent", task);

    const result = await stopTask({ task_id: "t-agent" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(task.status).toBe("stopped");
  });

  test("returns valid JSON string on success", async () => {
    const task = makeRunningTask("t-json");
    backgroundTaskRegistry.set("t-json", task);

    const result = await stopTask({ task_id: "t-json" });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
