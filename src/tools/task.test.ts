import { test, expect, describe, beforeEach } from "bun:test";
import {
  taskCreateTool,
  taskUpdateTool,
  taskGetTool,
  taskListTool,
  getAllTasks,
  getActiveTasks,
  onTasksChange,
} from "./task.ts";
import type { Task } from "./task.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Clear all in-memory tasks by marking every existing task as "deleted".
 * task.ts does not export a reset function, so we update every known task.
 */
async function clearAllTasks(): Promise<void> {
  const existing = getAllTasks();
  for (const t of existing) {
    await taskUpdateTool.execute({ taskId: t.id, status: "deleted" });
  }
}

async function createTask(
  subject: string,
  description = "test description",
  activeForm?: string,
): Promise<string> {
  const result = await taskCreateTool.execute({
    subject,
    description,
    ...(activeForm ? { activeForm } : {}),
  });
  // Result format: "Tarefa #<id> criada: <subject>\n\n..."
  const match = String(result).match(/Tarefa #(\d+) criada/);
  if (!match) throw new Error(`Unexpected create result: ${result}`);
  return match[1]!;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await clearAllTasks();
});

// ─── TaskCreate ──────────────────────────────────────────────────────────────

describe("TaskCreate", () => {
  test("creates a task with status 'pending'", async () => {
    const id = await createTask("Fix the login bug");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task).toBeDefined();
    expect(task!.status).toBe("pending");
  });

  test("created task has the correct subject", async () => {
    const id = await createTask("Implement search");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.subject).toBe("Implement search");
  });

  test("created task has the correct description", async () => {
    const id = await createTask("A task", "Detailed description here");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.description).toBe("Detailed description here");
  });

  test("activeForm defaults to subject when not provided", async () => {
    const id = await createTask("Deploy to production");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.activeForm).toBe("Deploy to production");
  });

  test("activeForm is set when explicitly provided", async () => {
    const id = await createTask("Deploy to production", "Desc", "Deploying to production");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.activeForm).toBe("Deploying to production");
  });

  test("created task has empty blocks and blockedBy arrays", async () => {
    const id = await createTask("Standalone task");
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.blocks).toEqual([]);
    expect(task!.blockedBy).toEqual([]);
  });

  test("created task has a createdAt timestamp", async () => {
    const id = await createTask("Timestamped task");
    const task = getAllTasks().find((t) => t.id === id);
    expect(typeof task!.createdAt).toBe("string");
    expect(task!.createdAt.length).toBeGreaterThan(0);
    // Should parse as a valid date
    expect(isNaN(Date.parse(task!.createdAt))).toBe(false);
  });

  test("returns an error message when subject is empty", async () => {
    const result = await taskCreateTool.execute({ subject: "", description: "desc" });
    expect(String(result)).toContain("Erro");
  });

  test("creating multiple tasks produces unique IDs", async () => {
    const id1 = await createTask("Task one");
    const id2 = await createTask("Task two");
    expect(id1).not.toBe(id2);
  });

  test("result message contains the new task ID and subject", async () => {
    const result = await taskCreateTool.execute({
      subject: "Write tests",
      description: "cover all branches",
    });
    expect(String(result)).toContain("Write tests");
    expect(String(result)).toMatch(/#\d+/);
  });

  test("metadata is stored on the task", async () => {
    const result = await taskCreateTool.execute({
      subject: "Meta task",
      description: "has metadata",
      metadata: { priority: "high", ticket: 42 },
    });
    const match = String(result).match(/Tarefa #(\d+) criada/);
    const id = match![1]!;
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.metadata?.["priority"]).toBe("high");
    expect(task.metadata?.["ticket"]).toBe(42);
  });
});

// ─── TaskGet ─────────────────────────────────────────────────────────────────

describe("TaskGet", () => {
  test("retrieves a task by ID and includes subject in output", async () => {
    const id = await createTask("Retrieve me");
    const result = await taskGetTool.execute({ taskId: id });
    expect(String(result)).toContain("Retrieve me");
    expect(String(result)).toContain(id);
  });

  test("shows status in the get output", async () => {
    const id = await createTask("Status display");
    const result = await taskGetTool.execute({ taskId: id });
    expect(String(result)).toContain("pending");
  });

  test("returns an error for a non-existent task ID", async () => {
    const result = await taskGetTool.execute({ taskId: "99999" });
    expect(String(result)).toContain("Erro");
    expect(String(result)).toContain("99999");
  });

  test("shows blockedBy in the output after a dependency is added", async () => {
    const blockerId = await createTask("Blocker task");
    const dependentId = await createTask("Dependent task");
    await taskUpdateTool.execute({
      taskId: dependentId,
      addBlockedBy: [blockerId],
    });
    const result = await taskGetTool.execute({ taskId: dependentId });
    expect(String(result)).toContain(blockerId);
  });

  test("shows description in verbose output", async () => {
    const id = await createTask("Described task", "The acceptance criteria are clear");
    const result = await taskGetTool.execute({ taskId: id });
    expect(String(result)).toContain("The acceptance criteria are clear");
  });
});

// ─── TaskUpdate ──────────────────────────────────────────────────────────────

describe("TaskUpdate — status changes", () => {
  test("updates status from pending to in_progress", async () => {
    const id = await createTask("Start me");
    await taskUpdateTool.execute({ taskId: id, status: "in_progress" });
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.status).toBe("in_progress");
  });

  test("updates status from in_progress to completed", async () => {
    const id = await createTask("Complete me");
    await taskUpdateTool.execute({ taskId: id, status: "in_progress" });
    await taskUpdateTool.execute({ taskId: id, status: "completed" });
    const task = getAllTasks().find((t) => t.id === id);
    expect(task!.status).toBe("completed");
  });

  test("setting status to deleted removes the task from getAllTasks", async () => {
    const id = await createTask("Delete me");
    await taskUpdateTool.execute({ taskId: id, status: "deleted" });
    const task = getAllTasks().find((t) => t.id === id);
    expect(task).toBeUndefined();
  });

  test("returns an error when task ID does not exist", async () => {
    const result = await taskUpdateTool.execute({ taskId: "88888", status: "completed" });
    expect(String(result)).toContain("Erro");
  });

  test("updates the subject", async () => {
    const id = await createTask("Old subject");
    await taskUpdateTool.execute({ taskId: id, subject: "New subject" });
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.subject).toBe("New subject");
  });

  test("updates the description", async () => {
    const id = await createTask("Desc task", "original");
    await taskUpdateTool.execute({ taskId: id, description: "updated description" });
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.description).toBe("updated description");
  });

  test("updates the owner", async () => {
    const id = await createTask("Owner task");
    await taskUpdateTool.execute({ taskId: id, owner: "agent-1" });
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.owner).toBe("agent-1");
  });

  test("updates the updatedAt timestamp after a change", async () => {
    const id = await createTask("Timestamp task");
    const before = getAllTasks().find((t) => t.id === id)!.updatedAt;
    // Ensure at least 1ms passes
    await new Promise((r) => setTimeout(r, 2));
    await taskUpdateTool.execute({ taskId: id, status: "in_progress" });
    const after = getAllTasks().find((t) => t.id === id)!.updatedAt;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});

describe("TaskUpdate — metadata merging", () => {
  test("merges new metadata keys into existing metadata", async () => {
    const result = await taskCreateTool.execute({
      subject: "Meta merge",
      description: "test",
      metadata: { key1: "val1" },
    });
    const id = String(result).match(/Tarefa #(\d+) criada/)![1]!;

    await taskUpdateTool.execute({ taskId: id, metadata: { key2: "val2" } });
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.metadata?.["key1"]).toBe("val1");
    expect(task.metadata?.["key2"]).toBe("val2");
  });

  test("setting a metadata key to null removes it", async () => {
    const result = await taskCreateTool.execute({
      subject: "Meta delete",
      description: "test",
      metadata: { removeMe: "yes" },
    });
    const id = String(result).match(/Tarefa #(\d+) criada/)![1]!;

    await taskUpdateTool.execute({ taskId: id, metadata: { removeMe: null } });
    const task = getAllTasks().find((t) => t.id === id)!;
    expect(task.metadata?.["removeMe"]).toBeUndefined();
  });
});

// ─── TaskList ─────────────────────────────────────────────────────────────────

describe("TaskList", () => {
  test("returns a no-tasks message when there are no tasks", async () => {
    const result = await taskListTool.execute({});
    expect(String(result)).toContain("nenhuma tarefa");
  });

  test("lists all non-deleted tasks", async () => {
    const id1 = await createTask("Alpha");
    const id2 = await createTask("Beta");
    const result = String(await taskListTool.execute({}));
    expect(result).toContain("Alpha");
    expect(result).toContain("Beta");
  });

  test("does not list deleted tasks", async () => {
    const id = await createTask("Ephemeral task");
    await taskUpdateTool.execute({ taskId: id, status: "deleted" });
    const result = String(await taskListTool.execute({}));
    expect(result).not.toContain("Ephemeral task");
  });

  test("includes task count in the output", async () => {
    await createTask("One");
    await createTask("Two");
    const result = String(await taskListTool.execute({}));
    expect(result).toContain("2");
  });
});

// ─── getAllTasks / getActiveTasks ─────────────────────────────────────────────

describe("getAllTasks()", () => {
  test("returns empty array when no tasks exist", async () => {
    expect(getAllTasks()).toEqual([]);
  });

  test("returns all non-deleted tasks", async () => {
    await createTask("Task A");
    await createTask("Task B");
    expect(getAllTasks().length).toBe(2);
  });

  test("excludes deleted tasks", async () => {
    const id = await createTask("Deleted task");
    await taskUpdateTool.execute({ taskId: id, status: "deleted" });
    const tasks = getAllTasks();
    expect(tasks.find((t) => t.id === id)).toBeUndefined();
  });
});

describe("getActiveTasks()", () => {
  test("returns empty array when no tasks are in_progress", async () => {
    await createTask("Idle task");
    expect(getActiveTasks()).toEqual([]);
  });

  test("returns only in_progress tasks", async () => {
    const id1 = await createTask("Running task");
    const id2 = await createTask("Pending task");
    await taskUpdateTool.execute({ taskId: id1, status: "in_progress" });

    const active = getActiveTasks();
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(id1);
  });

  test("does not include completed tasks", async () => {
    const id = await createTask("Done task");
    await taskUpdateTool.execute({ taskId: id, status: "completed" });
    expect(getActiveTasks()).toEqual([]);
  });
});

// ─── Dependencies ─────────────────────────────────────────────────────────────

describe("task dependencies — addBlockedBy", () => {
  test("addBlockedBy populates blockedBy on the dependent task", async () => {
    const blockerId = await createTask("Blocker");
    const depId = await createTask("Dependent");

    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });

    const dep = getAllTasks().find((t) => t.id === depId)!;
    expect(dep.blockedBy).toContain(blockerId);
  });

  test("addBlockedBy also populates blocks on the blocker task", async () => {
    const blockerId = await createTask("Blocker");
    const depId = await createTask("Dependent");

    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });

    const blocker = getAllTasks().find((t) => t.id === blockerId)!;
    expect(blocker.blocks).toContain(depId);
  });

  test("addBlocks on blocker populates blocks and blockedBy symmetrically", async () => {
    const blockerId = await createTask("Blocker via addBlocks");
    const depId = await createTask("Blocked task");

    await taskUpdateTool.execute({ taskId: blockerId, addBlocks: [depId] });

    const blocker = getAllTasks().find((t) => t.id === blockerId)!;
    const dep = getAllTasks().find((t) => t.id === depId)!;
    expect(blocker.blocks).toContain(depId);
    expect(dep.blockedBy).toContain(blockerId);
  });

  test("duplicate dependency entries are not added twice", async () => {
    const blockerId = await createTask("Unique blocker");
    const depId = await createTask("Unique dependent");

    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });
    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });

    const dep = getAllTasks().find((t) => t.id === depId)!;
    const occurrences = dep.blockedBy.filter((id) => id === blockerId);
    expect(occurrences.length).toBe(1);
  });

  test("a task blocked by a pending task cannot be moved to in_progress via the blockedBy list — blockedBy is populated", async () => {
    // The task.ts module tracks blockedBy for informational purposes.
    // The guard that PREVENTS starting a blocked task lives at the task
    // execution layer (caller's responsibility). We verify that the
    // metadata is correctly set so a caller CAN enforce the rule.
    const blockerId = await createTask("Pending blocker");
    const depId = await createTask("Blocked dependent");
    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });

    const dep = getAllTasks().find((t) => t.id === depId)!;
    const blocker = getAllTasks().find((t) => t.id === blockerId)!;

    // Blocker is still pending — dependent should know it's blocked
    expect(dep.blockedBy).toContain(blockerId);
    expect(blocker.status).toBe("pending");
  });

  test("completing the blocker does not clear blockedBy (it remains in the list)", async () => {
    const blockerId = await createTask("Completing blocker");
    const depId = await createTask("Waiting dependent");
    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });
    await taskUpdateTool.execute({ taskId: blockerId, status: "completed" });

    const dep = getAllTasks().find((t) => t.id === depId)!;
    // blockedBy list is not automatically cleared — the ID still appears
    expect(dep.blockedBy).toContain(blockerId);
  });
});

// ─── onTasksChange listener ───────────────────────────────────────────────────

describe("onTasksChange()", () => {
  test("listener is called when a task is created", async () => {
    let callCount = 0;
    const unsubscribe = onTasksChange(() => { callCount++; });
    try {
      await createTask("Trigger listener");
      expect(callCount).toBeGreaterThan(0);
    } finally {
      unsubscribe();
    }
  });

  test("listener is called when a task is updated", async () => {
    const id = await createTask("Update listener");
    let callCount = 0;
    const unsubscribe = onTasksChange(() => { callCount++; });
    try {
      await taskUpdateTool.execute({ taskId: id, status: "in_progress" });
      expect(callCount).toBeGreaterThan(0);
    } finally {
      unsubscribe();
    }
  });

  test("unsubscribed listener is no longer called", async () => {
    let callCount = 0;
    const unsubscribe = onTasksChange(() => { callCount++; });
    unsubscribe();
    await createTask("Silent task");
    expect(callCount).toBe(0);
  });
});

// ─── TaskGet formatted output ─────────────────────────────────────────────────

describe("TaskGet formatted output", () => {
  test("taskGetTool shows 'Metadados:' section when task has metadata", async () => {
    const id = await createTask("task com metadados");
    await taskUpdateTool.execute({
      taskId: id,
      metadata: { priority: "high", ticket: 42 },
    });
    const result = String(await taskGetTool.execute({ taskId: id }));
    expect(result).toContain("Metadados:");
    expect(result).toContain("priority");
    expect(result).toContain('"high"');
    expect(result).toContain("ticket");
    expect(result).toContain("42");
  });

  test("taskGetTool omits 'Metadados:' section when task has no metadata", async () => {
    const id = await createTask("task sem metadados");
    const result = String(await taskGetTool.execute({ taskId: id }));
    expect(result).not.toContain("Metadados:");
  });

  test("taskGetTool omits 'Metadados:' section when metadata is empty object", async () => {
    const id = await createTask("task metadata vazio");
    await taskUpdateTool.execute({ taskId: id, metadata: {} });
    const result = String(await taskGetTool.execute({ taskId: id }));
    expect(result).not.toContain("Metadados:");
  });

  test("taskGetTool shows blocks and blockedBy with #id format", async () => {
    const blockerId = await createTask("Bloqueador");
    const depId = await createTask("Dependente");
    // blockerId blocks depId: depId.blockedBy=[blockerId], blockerId.blocks=[depId]
    await taskUpdateTool.execute({ taskId: depId, addBlockedBy: [blockerId] });

    const blockerResult = String(await taskGetTool.execute({ taskId: blockerId }));
    expect(blockerResult).toContain(`#${depId}`);

    const depResult = String(await taskGetTool.execute({ taskId: depId }));
    expect(depResult).toContain(`#${blockerId}`);
  });

  test("taskGetTool returns error when task not found", async () => {
    const result = String(await taskGetTool.execute({ taskId: "99999" }));
    expect(result).toContain("não encontrada");
  });
});
