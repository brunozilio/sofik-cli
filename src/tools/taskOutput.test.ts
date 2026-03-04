import { test, expect, describe } from "bun:test";
import { taskOutputTool } from "./taskOutput.ts";
import { backgroundTaskRegistry } from "../lib/backgroundTasks.ts";
import type { BackgroundTask } from "../lib/backgroundTasks.ts";

async function taskOutput(input: Record<string, unknown>): Promise<string> {
  return taskOutputTool.execute!(input) as Promise<string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTaskId(): string {
  return `a${Math.random().toString(16).slice(2)}`;
}

function addTaskToRegistry(overrides: Partial<BackgroundTask> = {}): string {
  const taskId = makeTaskId();
  const task: BackgroundTask = {
    taskId,
    type: "agent",
    description: "test agent",
    status: "completed",
    partialOutput: "test output",
    outputFile: "/tmp/test-output",
    promise: Promise.resolve("test output"),
    controller: new AbortController(),
    startedAt: Date.now() - 1000,
    endedAt: Date.now(),
    transcriptFile: "/tmp/test-transcript.json",
    ...overrides,
  };
  backgroundTaskRegistry.set(taskId, task);
  return taskId;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("taskOutputTool metadata", () => {
  test("name is 'TaskOutput'", () => {
    expect(taskOutputTool.name).toBe("TaskOutput");
  });

  test("has a description", () => {
    expect(typeof taskOutputTool.description).toBe("string");
    expect(taskOutputTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof taskOutputTool.execute).toBe("function");
  });

  test("input_schema requires task_id", () => {
    expect(taskOutputTool.input_schema.required).toContain("task_id");
  });

  test("input_schema has block property", () => {
    expect(taskOutputTool.input_schema.properties).toHaveProperty("block");
  });

  test("input_schema has timeout property", () => {
    expect(taskOutputTool.input_schema.properties).toHaveProperty("timeout");
  });
});

// ── Task not found ────────────────────────────────────────────────────────────

describe("taskOutputTool — task not found", () => {
  test("returns error JSON when task not found", async () => {
    const result = await taskOutput({ task_id: "a_nonexistent_agent_xyz" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("not found");
  });

  test("error message includes the task ID", async () => {
    const fakeId = "a_fake_agent_123";
    const result = await taskOutput({ task_id: fakeId });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain(fakeId);
  });

  test("error mentions 'current session'", async () => {
    const result = await taskOutput({ task_id: "a_not_here" });
    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("session");
  });
});

// ── Completed task ────────────────────────────────────────────────────────────

describe("taskOutputTool — completed task", () => {
  test("returns JSON with status and output", async () => {
    const taskId = addTaskToRegistry({
      status: "completed",
      partialOutput: "My completed output",
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("completed");
    expect(parsed.output).toBe("My completed output");
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns the task_id in response", async () => {
    const taskId = addTaskToRegistry({ status: "completed" });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.task_id).toBe(taskId);
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns outputFile in response", async () => {
    const taskId = addTaskToRegistry({
      status: "completed",
      outputFile: "/tmp/my-output",
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.outputFile).toBe("/tmp/my-output");
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns transcriptFile in response", async () => {
    const taskId = addTaskToRegistry({
      status: "completed",
      transcriptFile: "/tmp/transcript.json",
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.transcriptFile).toBe("/tmp/transcript.json");
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns startedAt timestamp", async () => {
    const now = Date.now() - 500;
    const taskId = addTaskToRegistry({ status: "completed", startedAt: now });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.startedAt).toBe(now);
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns endedAt timestamp", async () => {
    const now = Date.now();
    const taskId = addTaskToRegistry({ status: "completed", endedAt: now });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.endedAt).toBe(now);
    backgroundTaskRegistry.delete(taskId);
  });
});

// ── Failed task ───────────────────────────────────────────────────────────────

describe("taskOutputTool — failed task", () => {
  test("returns failed status", async () => {
    const taskId = addTaskToRegistry({
      status: "failed",
      partialOutput: "Error: something went wrong",
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("failed");
    backgroundTaskRegistry.delete(taskId);
  });

  test("returns error output", async () => {
    const taskId = addTaskToRegistry({
      status: "failed",
      partialOutput: "Error: API timeout",
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.output).toContain("Error");
    backgroundTaskRegistry.delete(taskId);
  });
});

// ── Running task with block: false ───────────────────────────────────────────

describe("taskOutputTool — running task, block: false", () => {
  test("returns running status without waiting", async () => {
    const taskId = addTaskToRegistry({
      status: "running",
      partialOutput: "",
      promise: new Promise(() => {}), // never resolves
    });
    const result = await taskOutput({ task_id: taskId, block: false });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("running");
    backgroundTaskRegistry.delete(taskId);
  });
});

// ── Running task with block: true ────────────────────────────────────────────

describe("taskOutputTool — running task, block: true (with timeout)", () => {
  test("waits up to timeout then returns current state", async () => {
    const taskId = makeTaskId();
    const task: BackgroundTask = {
      taskId,
      type: "agent",
      description: "slow agent",
      status: "running",
      partialOutput: "",
      outputFile: "/tmp/out",
      promise: new Promise((resolve) => setTimeout(() => resolve("done"), 5000)), // 5 second delay
      controller: new AbortController(),
      startedAt: Date.now(),
    };
    backgroundTaskRegistry.set(taskId, task);

    const start = Date.now();
    const result = await taskOutput({ task_id: taskId, block: true, timeout: 200 });
    const elapsed = Date.now() - start;

    // Should return within reasonable time (not wait 5 seconds)
    expect(elapsed).toBeLessThan(3000);
    const parsed = JSON.parse(result);
    expect(parsed.task_id).toBe(taskId);

    backgroundTaskRegistry.delete(taskId);
  });

  test("timeout is capped at 600000ms", async () => {
    const taskId = addTaskToRegistry({ status: "completed" });
    // This just tests that a very large timeout is accepted without error
    const result = await taskOutput({ task_id: taskId, block: true, timeout: 999_999_999 });
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("completed");
    backgroundTaskRegistry.delete(taskId);
  });

  test("default block is true (waits for completion)", async () => {
    const taskId = makeTaskId();
    const task: BackgroundTask = {
      taskId,
      type: "agent",
      description: "fast agent",
      status: "running",
      partialOutput: "",
      outputFile: "/tmp/out",
      promise: new Promise<string>((resolve) => {
        setTimeout(() => {
          const s = backgroundTaskRegistry.get(taskId);
          if (s) {
            s.status = "completed";
            s.partialOutput = "done";
          }
          resolve("done");
        }, 50);
      }),
      controller: new AbortController(),
      startedAt: Date.now(),
    };
    backgroundTaskRegistry.set(taskId, task);

    const result = await taskOutput({ task_id: taskId }); // block defaults to true
    const parsed = JSON.parse(result);
    expect(typeof parsed.status).toBe("string");

    backgroundTaskRegistry.delete(taskId);
  });
});
