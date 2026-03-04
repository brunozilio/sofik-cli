import { test, expect, describe, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";

// Use in-memory SQLite — must be set before any import that triggers getDb()
process.env.DATABASE_URL = ":memory:";

import {
  createTask,
  getTask,
  listTasks,
  getNextPendingTask,
  updateTaskStatus,
  updateTaskPlan,
  cancelTask,
  clearCompletedTasks,
} from "./tasks.ts";
import type { Task, TaskStatus } from "./tasks.ts";
import { dbRun } from "../index.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Unique context string so tests don't accidentally cross-match each other's rows. */
function ctx(label: string): string {
  return `[${randomUUID()}] ${label}`;
}

// ── Reset state between every test ────────────────────────────────────────────

beforeEach(() => {
  dbRun("DELETE FROM tasks", []);
});

// ── createTask ─────────────────────────────────────────────────────────────────

describe("createTask", () => {
  test("creates a task and returns it", () => {
    const task = createTask(ctx("basic create"));
    expect(task).toBeDefined();
    expect(typeof task.id).toBe("string");
    expect(task.id.length).toBeGreaterThan(0);
  });

  test("default status is 'pending'", () => {
    const task = createTask(ctx("default status"));
    expect(task.status).toBe("pending");
  });

  test("respects a custom status", () => {
    const task = createTask(ctx("planning status"), { status: "planning" });
    expect(task.status).toBe("planning");
  });

  test("stores the context string verbatim", () => {
    const context = ctx("my task context");
    const task = createTask(context);
    expect(task.context).toBe(context);
  });

  test("position increments for each subsequent active task", () => {
    const t1 = createTask(ctx("pos 0"));
    const t2 = createTask(ctx("pos 1"));
    const t3 = createTask(ctx("pos 2"));
    expect(t1.position).toBe(0);
    expect(t2.position).toBe(1);
    expect(t3.position).toBe(2);
  });

  test("stores worktree_path when provided", () => {
    const task = createTask(ctx("worktree path"), { worktree_path: "/tmp/my-worktree" });
    expect(task.worktree_path).toBe("/tmp/my-worktree");
  });

  test("stores worktree_branch when provided", () => {
    const task = createTask(ctx("worktree branch"), { worktree_branch: "feature/my-branch" });
    expect(task.worktree_branch).toBe("feature/my-branch");
  });

  test("worktree_path and worktree_branch are null when not provided", () => {
    const task = createTask(ctx("no worktree"));
    expect(task.worktree_path).toBeNull();
    expect(task.worktree_branch).toBeNull();
  });

  test("created_at and updated_at are ISO strings", () => {
    const task = createTask(ctx("timestamps"));
    expect(() => new Date(task.created_at)).not.toThrow();
    expect(() => new Date(task.updated_at)).not.toThrow();
    expect(new Date(task.created_at).toISOString()).toBe(task.created_at);
  });

  test("plan is null on creation", () => {
    const task = createTask(ctx("plan null"));
    expect(task.plan).toBeNull();
  });
});

// ── getTask ────────────────────────────────────────────────────────────────────

describe("getTask", () => {
  test("retrieves a task by exact id", () => {
    const created = createTask(ctx("exact id"));
    const found = getTask(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.context).toBe(created.context);
  });

  test("retrieves a task by partial id prefix", () => {
    const created = createTask(ctx("prefix id"));
    const prefix = created.id.slice(0, 8);
    const found = getTask(prefix);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  test("returns null for an unknown id", () => {
    const result = getTask("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  test("returns null for a random unknown prefix", () => {
    // Ensure the prefix doesn't accidentally match anything
    dbRun("DELETE FROM tasks", []);
    const result = getTask("zzzzzzzz");
    expect(result).toBeNull();
  });

  test("all Task fields are returned", () => {
    const created = createTask(ctx("full fields"), {
      worktree_path: "/tmp/wt",
      worktree_branch: "main",
    });
    const found = getTask(created.id)!;
    expect(found.id).toBeDefined();
    expect(found.context).toBeDefined();
    expect(found.status).toBeDefined();
    expect(found.position).toBeDefined();
    expect(found.worktree_path).toBe("/tmp/wt");
    expect(found.worktree_branch).toBe("main");
    expect(found.created_at).toBeDefined();
    expect(found.updated_at).toBeDefined();
  });
});

// ── listTasks ──────────────────────────────────────────────────────────────────

describe("listTasks", () => {
  test("returns empty array when there are no tasks", () => {
    const tasks = listTasks();
    expect(tasks).toEqual([]);
  });

  test("returns all tasks", () => {
    createTask(ctx("t1"));
    createTask(ctx("t2"));
    createTask(ctx("t3"));
    const tasks = listTasks();
    expect(tasks.length).toBe(3);
  });

  test("tasks are ordered by position ascending", () => {
    const t1 = createTask(ctx("first"));
    const t2 = createTask(ctx("second"));
    const t3 = createTask(ctx("third"));
    const tasks = listTasks();
    expect(tasks[0].id).toBe(t1.id);
    expect(tasks[1].id).toBe(t2.id);
    expect(tasks[2].id).toBe(t3.id);
  });

  test("includes tasks of all statuses", () => {
    createTask(ctx("pending"), { status: "pending" });
    createTask(ctx("planning"), { status: "planning" });
    const t3 = createTask(ctx("done"), { status: "done" });
    updateTaskStatus(t3.id, "done");
    const tasks = listTasks();
    const statuses = tasks.map((t) => t.status);
    expect(statuses).toContain("pending");
    expect(statuses).toContain("planning");
    expect(statuses).toContain("done");
  });
});

// ── getNextPendingTask ─────────────────────────────────────────────────────────

describe("getNextPendingTask", () => {
  test("returns null when no tasks exist", () => {
    expect(getNextPendingTask()).toBeNull();
  });

  test("returns null when no tasks are pending", () => {
    const task = createTask(ctx("running task"), { status: "running" });
    updateTaskStatus(task.id, "running");
    expect(getNextPendingTask()).toBeNull();
  });

  test("returns the first pending task by position", () => {
    const t1 = createTask(ctx("first pending"));
    const t2 = createTask(ctx("second pending"));
    const next = getNextPendingTask();
    expect(next?.id).toBe(t1.id);
    // t2 should not be returned until t1 is handled
    expect(next?.id).not.toBe(t2.id);
  });

  test("returns a pending task even when non-pending tasks are present", () => {
    const done = createTask(ctx("done task"), { status: "done" });
    updateTaskStatus(done.id, "done");
    const pending = createTask(ctx("pending task"));
    const next = getNextPendingTask();
    expect(next?.id).toBe(pending.id);
  });

  test("skips planning tasks (only returns pending)", () => {
    createTask(ctx("planning task"), { status: "planning" });
    expect(getNextPendingTask()).toBeNull();

    const pendingTask = createTask(ctx("actually pending"));
    expect(getNextPendingTask()?.id).toBe(pendingTask.id);
  });
});

// ── updateTaskStatus ───────────────────────────────────────────────────────────

describe("updateTaskStatus", () => {
  test("changes the task status", () => {
    const task = createTask(ctx("status change"));
    updateTaskStatus(task.id, "running");
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("running");
  });

  test("updates updated_at timestamp", async () => {
    const task = createTask(ctx("timestamp update"));
    const before = task.updated_at;
    // Small delay to guarantee a different timestamp
    await new Promise((r) => setTimeout(r, 5));
    updateTaskStatus(task.id, "done");
    const updated = getTask(task.id)!;
    expect(updated.updated_at >= before).toBe(true);
  });

  test("sets started_at when provided", () => {
    const task = createTask(ctx("started at"));
    const now = new Date().toISOString();
    updateTaskStatus(task.id, "running", { started_at: now });
    const updated = getTask(task.id)!;
    expect(updated.started_at).toBe(now);
  });

  test("sets completed_at when provided", () => {
    const task = createTask(ctx("completed at"));
    const now = new Date().toISOString();
    updateTaskStatus(task.id, "done", { completed_at: now });
    const updated = getTask(task.id)!;
    expect(updated.completed_at).toBe(now);
  });

  test("started_at remains null when not provided", () => {
    const task = createTask(ctx("no started_at"));
    updateTaskStatus(task.id, "running");
    const updated = getTask(task.id)!;
    expect(updated.started_at).toBeNull();
  });

  test("can transition through planning -> pending -> running -> done", () => {
    const task = createTask(ctx("full lifecycle"), { status: "planning" });
    updateTaskStatus(task.id, "pending");
    expect(getTask(task.id)?.status).toBe("pending");
    updateTaskStatus(task.id, "running");
    expect(getTask(task.id)?.status).toBe("running");
    updateTaskStatus(task.id, "done");
    expect(getTask(task.id)?.status).toBe("done");
  });
});

// ── updateTaskPlan ─────────────────────────────────────────────────────────────

describe("updateTaskPlan", () => {
  test("sets the plan field on a task", () => {
    const task = createTask(ctx("plan set"));
    updateTaskPlan(task.id, "Step 1: do something\nStep 2: do more");
    const updated = getTask(task.id)!;
    expect(updated.plan).toBe("Step 1: do something\nStep 2: do more");
  });

  test("overwrites an existing plan", () => {
    const task = createTask(ctx("plan overwrite"));
    updateTaskPlan(task.id, "original plan");
    updateTaskPlan(task.id, "new plan");
    const updated = getTask(task.id)!;
    expect(updated.plan).toBe("new plan");
  });

  test("plan can be set to an empty string", () => {
    const task = createTask(ctx("empty plan"));
    updateTaskPlan(task.id, "some text");
    updateTaskPlan(task.id, "");
    const updated = getTask(task.id)!;
    expect(updated.plan).toBe("");
  });

  test("returns void", () => {
    const task = createTask(ctx("plan void"));
    const result = updateTaskPlan(task.id, "plan text");
    expect(result).toBeUndefined();
  });
});

// ── cancelTask ─────────────────────────────────────────────────────────────────

describe("cancelTask", () => {
  test("cancels a pending task and returns true", () => {
    const task = createTask(ctx("cancel pending"));
    const result = cancelTask(task.id);
    expect(result).toBe(true);
    expect(getTask(task.id)?.status).toBe("cancelled");
  });

  test("cancels a planning task and returns true", () => {
    const task = createTask(ctx("cancel planning"), { status: "planning" });
    const result = cancelTask(task.id);
    expect(result).toBe(true);
    expect(getTask(task.id)?.status).toBe("cancelled");
  });

  test("returns false for a running task (cannot cancel)", () => {
    const task = createTask(ctx("cancel running"));
    updateTaskStatus(task.id, "running");
    const result = cancelTask(task.id);
    expect(result).toBe(false);
    expect(getTask(task.id)?.status).toBe("running");
  });

  test("returns false for a done task", () => {
    const task = createTask(ctx("cancel done"));
    updateTaskStatus(task.id, "done");
    const result = cancelTask(task.id);
    expect(result).toBe(false);
  });

  test("returns false for an unknown id", () => {
    const result = cancelTask("00000000-0000-0000-0000-000000000000");
    expect(result).toBe(false);
  });

  test("sets completed_at when cancelling", () => {
    const task = createTask(ctx("cancel completed_at"));
    cancelTask(task.id);
    const updated = getTask(task.id)!;
    expect(updated.completed_at).not.toBeNull();
    expect(() => new Date(updated.completed_at!)).not.toThrow();
  });
});

// ── clearCompletedTasks ────────────────────────────────────────────────────────

describe("clearCompletedTasks", () => {
  test("returns 0 when there are no completed/failed/cancelled tasks", () => {
    createTask(ctx("active"));
    const count = clearCompletedTasks();
    expect(count).toBe(0);
  });

  test("deletes done tasks and returns the count", () => {
    const t = createTask(ctx("done task"), { status: "done" });
    updateTaskStatus(t.id, "done");
    const count = clearCompletedTasks();
    expect(count).toBe(1);
    expect(getTask(t.id)).toBeNull();
  });

  test("deletes failed tasks and returns the count", () => {
    const t = createTask(ctx("failed task"));
    updateTaskStatus(t.id, "failed");
    const count = clearCompletedTasks();
    expect(count).toBe(1);
    expect(getTask(t.id)).toBeNull();
  });

  test("deletes cancelled tasks and returns the count", () => {
    const t = createTask(ctx("cancelled task"));
    cancelTask(t.id);
    const count = clearCompletedTasks();
    expect(count).toBe(1);
    expect(getTask(t.id)).toBeNull();
  });

  test("deletes all terminal-status tasks and returns total count", () => {
    const d = createTask(ctx("done"));
    updateTaskStatus(d.id, "done");
    const f = createTask(ctx("failed"));
    updateTaskStatus(f.id, "failed");
    const c = createTask(ctx("cancelled"));
    cancelTask(c.id);
    const count = clearCompletedTasks();
    expect(count).toBe(3);
  });

  test("leaves pending tasks intact", () => {
    const pending = createTask(ctx("keep pending"));
    const done = createTask(ctx("remove done"));
    updateTaskStatus(done.id, "done");

    clearCompletedTasks();

    expect(getTask(pending.id)).not.toBeNull();
    expect(getTask(done.id)).toBeNull();
  });

  test("leaves running tasks intact", () => {
    const running = createTask(ctx("keep running"));
    updateTaskStatus(running.id, "running");
    const done = createTask(ctx("remove done 2"));
    updateTaskStatus(done.id, "done");

    clearCompletedTasks();

    expect(getTask(running.id)).not.toBeNull();
    expect(getTask(done.id)).toBeNull();
  });

  test("leaves planning tasks intact", () => {
    const planning = createTask(ctx("keep planning"), { status: "planning" });
    const failed = createTask(ctx("remove failed"));
    updateTaskStatus(failed.id, "failed");

    clearCompletedTasks();

    const remaining = listTasks();
    expect(remaining.some((t) => t.id === planning.id)).toBe(true);
    expect(getTask(failed.id)).toBeNull();
  });

  test("returns 0 on a second call when nothing new to clear", () => {
    const t = createTask(ctx("clear twice"));
    updateTaskStatus(t.id, "done");

    clearCompletedTasks();
    const second = clearCompletedTasks();
    expect(second).toBe(0);
  });
});
