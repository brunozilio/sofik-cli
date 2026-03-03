import { randomUUID } from "crypto";
import { dbQuery, dbQueryOne, dbRun } from "../index.ts";
import { logger } from "../../lib/logger.ts";

export type TaskStatus = "planning" | "pending" | "running" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  context: string;
  status: TaskStatus;
  position: number;
  worktree_path: string | null;
  worktree_branch: string | null;
  plan: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function createTask(
  context: string,
  opts: { worktree_path?: string; worktree_branch?: string; status?: TaskStatus } = {}
): Task {
  const id = randomUUID();
  const now = new Date().toISOString();
  const status = opts.status ?? "pending";
  const maxRow = dbQueryOne<{ max_pos: number | null }>(
    "SELECT MAX(position) AS max_pos FROM tasks WHERE status IN ('planning', 'pending', 'running')",
    []
  );
  const position = (maxRow?.max_pos ?? -1) + 1;
  dbRun(
    `INSERT INTO tasks (id, context, status, position, worktree_path, worktree_branch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, context, status, position, opts.worktree_path ?? null, opts.worktree_branch ?? null, now, now]
  );
  logger.job.info("Job criado", { taskId: id, status, position, contextPreview: context.slice(0, 100) });
  return getTask(id)!;
}

export function getTask(id: string): Task | null {
  const exact = dbQueryOne<Task>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (exact) return exact;
  // Support partial ID prefix match
  return dbQueryOne<Task>("SELECT * FROM tasks WHERE id LIKE ?", [`${id}%`]);
}

export function listTasks(): Task[] {
  return dbQuery<Task>(
    "SELECT * FROM tasks ORDER BY position ASC, created_at ASC",
    []
  );
}

export function getNextPendingTask(): Task | null {
  return dbQueryOne<Task>(
    "SELECT * FROM tasks WHERE status = 'pending' ORDER BY position ASC, created_at ASC LIMIT 1",
    []
  );
}

export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  extra: { started_at?: string; completed_at?: string } = {}
): void {
  const now = new Date().toISOString();
  const fields = ["status = ?", "updated_at = ?"];
  const values: (string | null)[] = [status, now];
  if (extra.started_at !== undefined) {
    fields.push("started_at = ?");
    values.push(extra.started_at);
  }
  if (extra.completed_at !== undefined) {
    fields.push("completed_at = ?");
    values.push(extra.completed_at);
  }
  values.push(id);
  dbRun(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values);
  logger.job.info("Status do job atualizado", { taskId: id, status });
}

export function updateTaskPlan(id: string, plan: string): void {
  dbRun(
    "UPDATE tasks SET plan = ?, updated_at = ? WHERE id = ?",
    [plan, new Date().toISOString(), id]
  );
  logger.job.info("Plano do job salvo", { taskId: id, planLength: plan.length });
}

export function cancelTask(id: string): boolean {
  const task = getTask(id);
  if (!task || !["pending", "planning"].includes(task.status)) return false;
  updateTaskStatus(id, "cancelled", { completed_at: new Date().toISOString() });
  logger.job.info("Job cancelado", { taskId: id });
  return true;
}

export function clearCompletedTasks(): number {
  const rows = dbQuery<{ id: string }>(
    "SELECT id FROM tasks WHERE status IN ('done', 'failed', 'cancelled')",
    []
  );
  dbRun("DELETE FROM tasks WHERE status IN ('done', 'failed', 'cancelled')", []);
  logger.job.info("Jobs concluídos removidos", { count: rows.length });
  return rows.length;
}
