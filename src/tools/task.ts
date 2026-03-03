import type { ToolDefinition } from "../lib/types.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm: string; // text shown in spinner while in_progress
  status: TaskStatus;
  owner?: string;
  metadata?: Record<string, unknown>;
  /** IDs of tasks that this task blocks (those tasks can't start until this completes) */
  blocks: string[];
  /** IDs of tasks that must complete before this one can start */
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── In-memory store ───────────────────────────────────────────────────────

let tasks: Map<string, Task> = new Map();
let nextId = 1;

// Listeners that get called when task state changes (used by UI)
const changeListeners: Array<() => void> = [];

export function onTasksChange(cb: () => void): () => void {
  changeListeners.push(cb);
  return () => {
    const idx = changeListeners.indexOf(cb);
    if (idx !== -1) changeListeners.splice(idx, 1);
  };
}

function notify(): void {
  for (const cb of changeListeners) cb();
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function generateId(): string {
  return String(nextId++);
}

function getTask(id: string): Task | null {
  return tasks.get(id) ?? null;
}

function formatTask(t: Task, verbose = false): string {
  const statusIcon: Record<TaskStatus, string> = {
    pending: "○",
    in_progress: "◉",
    completed: "✓",
    deleted: "✗",
  };
  let line = `${statusIcon[t.status]} #${t.id}. [${t.status}] ${t.subject}`;
  if (t.owner) line += ` (owner: ${t.owner})`;
  if (t.blockedBy.length) line += ` [blocked by: ${t.blockedBy.join(", ")}]`;
  if (t.blocks.length) line += ` [blocks: ${t.blocks.join(", ")}]`;
  if (verbose && t.description) line += `\n   ${t.description}`;
  return line;
}

function renderList(statusFilter?: TaskStatus[]): string {
  const visible = Array.from(tasks.values()).filter(
    (t) =>
      t.status !== "deleted" &&
      (statusFilter == null || statusFilter.includes(t.status))
  );
  if (visible.length === 0) return "(nenhuma tarefa)";
  return visible.map((t) => formatTask(t)).join("\n");
}

/** Get all non-deleted tasks */
export function getAllTasks(): Task[] {
  return Array.from(tasks.values()).filter((t) => t.status !== "deleted");
}

/** Get tasks currently in_progress (for spinner display) */
export function getActiveTasks(): Task[] {
  return Array.from(tasks.values()).filter((t) => t.status === "in_progress");
}

// ─── Tools ─────────────────────────────────────────────────────────────────

export const taskCreateTool: ToolDefinition = {
  name: "TaskCreate",
  description:
    "Create a new task to track progress on a multi-step job. Use this proactively when starting " +
    "complex tasks to show the user what you're doing. Provide a clear subject (imperative form), " +
    "description with context and acceptance criteria, and activeForm (present continuous, shown in " +
    "spinner while working). All tasks are created with status 'pending'.",
  input_schema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description: "Brief task title in imperative form (e.g., 'Fix authentication bug')",
      },
      description: {
        type: "string",
        description: "Detailed description of what needs to be done and acceptance criteria",
      },
      activeForm: {
        type: "string",
        description:
          "Present continuous form shown in spinner when in_progress (e.g., 'Fixing authentication bug')",
      },
      metadata: {
        type: "object",
        description: "Optional arbitrary metadata to attach",
      },
    },
    required: ["subject", "description"],
  },
  async execute(input) {
    const subject = String(input["subject"] ?? "").trim();
    const description = String(input["description"] ?? "").trim();
    const activeForm = String(input["activeForm"] ?? subject).trim();
    const metadata = (input["metadata"] as Record<string, unknown> | undefined) ?? {};

    if (!subject) return "Erro: subject é obrigatório";

    const id = generateId();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      subject,
      description,
      activeForm,
      status: "pending",
      metadata,
      blocks: [],
      blockedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    tasks.set(id, task);
    notify();

    return `Tarefa #${id} criada: ${subject}\n\nTarefas atuais:\n${renderList()}`;
  },
};

export const taskUpdateTool: ToolDefinition = {
  name: "TaskUpdate",
  description:
    "Update an existing task — change its status, owner, subject, description, or dependencies. " +
    "Mark tasks as in_progress BEFORE beginning work. Mark as completed ONLY when fully done. " +
    "Use addBlocks/addBlockedBy to establish dependencies between tasks. " +
    "Set status to 'deleted' to permanently remove a task.",
  input_schema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The ID of the task to update" },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "deleted"],
        description: "New status for the task",
      },
      subject: { type: "string", description: "New subject (imperative form)" },
      description: { type: "string", description: "New description" },
      activeForm: {
        type: "string",
        description: "New present-continuous form for spinner display",
      },
      owner: { type: "string", description: "Agent or person responsible for this task" },
      addBlocks: {
        type: "array",
        items: { type: "string" },
        description: "Task IDs that this task blocks (they depend on this)",
      },
      addBlockedBy: {
        type: "array",
        items: { type: "string" },
        description: "Task IDs that must complete before this task can start",
      },
      metadata: {
        type: "object",
        description: "Metadata keys to merge (set a key to null to delete it)",
      },
    },
    required: ["taskId"],
  },
  async execute(input) {
    const id = String(input["taskId"] ?? "");
    const task = getTask(id);
    if (!task) return `Erro: Tarefa #${id} não encontrada`;

    const now = new Date().toISOString();
    if (input["status"] !== undefined) task.status = input["status"] as TaskStatus;
    if (input["subject"] !== undefined) task.subject = String(input["subject"]);
    if (input["description"] !== undefined) task.description = String(input["description"]);
    if (input["activeForm"] !== undefined) task.activeForm = String(input["activeForm"]);
    if (input["owner"] !== undefined) task.owner = String(input["owner"]);
    task.updatedAt = now;

    // Dependency management
    const addBlocks = (input["addBlocks"] as string[] | undefined) ?? [];
    for (const bid of addBlocks) {
      if (!task.blocks.includes(bid)) task.blocks.push(bid);
      const other = getTask(bid);
      if (other && !other.blockedBy.includes(id)) {
        other.blockedBy.push(id);
        other.updatedAt = now;
      }
    }

    const addBlockedBy = (input["addBlockedBy"] as string[] | undefined) ?? [];
    for (const bid of addBlockedBy) {
      if (!task.blockedBy.includes(bid)) task.blockedBy.push(bid);
      const other = getTask(bid);
      if (other && !other.blocks.includes(id)) {
        other.blocks.push(id);
        other.updatedAt = now;
      }
    }

    // Merge metadata
    if (input["metadata"] && typeof input["metadata"] === "object") {
      task.metadata = task.metadata ?? {};
      for (const [k, v] of Object.entries(input["metadata"] as Record<string, unknown>)) {
        if (v === null) {
          delete task.metadata[k];
        } else {
          task.metadata[k] = v;
        }
      }
    }

    notify();
    return `Tarefa #${id} atualizada.\n\nTarefas atuais:\n${renderList()}`;
  },
};

export const taskGetTool: ToolDefinition = {
  name: "TaskGet",
  description:
    "Retrieve full details of a specific task by ID, including description, status, dependencies, " +
    "and metadata. Use this before starting work on a task to understand the full requirements.",
  input_schema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "The ID of the task to retrieve" },
    },
    required: ["taskId"],
  },
  async execute(input) {
    const id = String(input["taskId"] ?? "");
    const task = getTask(id);
    if (!task) return `Erro: Tarefa #${id} não encontrada`;

    const lines = [
      `Tarefa #${task.id}: ${task.subject}`,
      `Status:        ${task.status}`,
      `Forma ativa:   ${task.activeForm}`,
      `Responsável:   ${task.owner ?? "(nenhum)"}`,
      `Criado:        ${task.createdAt}`,
      `Atualizado:    ${task.updatedAt}`,
      `Bloqueia:      ${task.blocks.length ? task.blocks.map((b) => `#${b}`).join(", ") : "(nenhum)"}`,
      `Bloqueado por: ${task.blockedBy.length ? task.blockedBy.map((b) => `#${b}`).join(", ") : "(nenhum)"}`,
      ``,
      `Descrição:`,
      task.description || "(sem descrição)",
    ];

    if (task.metadata && Object.keys(task.metadata).length) {
      lines.push(``, `Metadados:`);
      for (const [k, v] of Object.entries(task.metadata)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`);
      }
    }

    return lines.join("\n");
  },
};

export const taskListTool: ToolDefinition = {
  name: "TaskList",
  description:
    "List all tasks in summary form. Shows id, subject, status, owner, and blockers. " +
    "Use TaskGet with a specific taskId to view full details. " +
    "Prefer working on tasks in ID order (lowest first) when multiple are available.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_input) {
    const all = Array.from(tasks.values()).filter((t) => t.status !== "deleted");
    if (all.length === 0) return "(nenhuma tarefa)";

    return (
      `Tarefas (${all.length} no total):\n` +
      all.map((t) => formatTask(t)).join("\n")
    );
  },
};
