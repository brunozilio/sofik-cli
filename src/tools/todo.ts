import type { ToolDefinition } from "../lib/types.ts";

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
}

// In-memory store shared across both tools in the same session
let todos: TodoItem[] = [];
let nextId = 1;

function renderList(items: TodoItem[]): string {
  if (items.length === 0) return "(no tasks)";

  const statusIcon: Record<TodoStatus, string> = {
    pending: "○",
    in_progress: "◉",
    completed: "✓",
  };
  const priorityLabel: Record<TodoPriority, string> = {
    high: "[high]",
    medium: "[med]",
    low: "[low]",
  };

  return items
    .map(
      (t) =>
        `${statusIcon[t.status]} ${t.id}. ${priorityLabel[t.priority]} ${t.content}${t.status === "completed" ? " (done)" : ""}`
    )
    .join("\n");
}

export const todoWriteTool: ToolDefinition = {
  name: "TodoWrite",
  description:
    "Create or update the task list for the current session. Use this to track multi-step work so the user can see your progress. Update task status as you work: set to in_progress when starting, completed when done.",
  input_schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The complete list of todos to set (replaces current list)",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique id (e.g. '1', '2')" },
            content: { type: "string", description: "Task description" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
            },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
          },
          required: ["id", "content", "status", "priority"],
        },
      },
    },
    required: ["todos"],
  },
  async execute(input) {
    const raw = input["todos"] as Array<{
      id: string;
      content: string;
      status: TodoStatus;
      priority: TodoPriority;
    }>;

    todos = raw.map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status ?? "pending",
      priority: t.priority ?? "medium",
    }));

    return `Tasks updated:\n${renderList(todos)}`;
  },
};

export const todoReadTool: ToolDefinition = {
  name: "TodoRead",
  description:
    "Read the current task list for this session. Use this to check which tasks are pending, in progress, or completed.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_input) {
    return `Current tasks:\n${renderList(todos)}`;
  },
};

export function getTodos(): TodoItem[] {
  return todos;
}
