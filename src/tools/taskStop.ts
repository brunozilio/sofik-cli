import type { ToolDefinition } from "../lib/types.ts";
import { backgroundTaskRegistry } from "../lib/backgroundTasks.ts";
import { logger } from "../lib/logger.ts";

export const taskStopTool: ToolDefinition = {
  name: "TaskStop",
  description: `Stop a running background task by its ID.
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Works for both background agents and bash commands`,
  input_schema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The task ID to stop (from Agent or Bash with run_in_background: true)",
      },
    },
    required: ["task_id"],
  },
  async execute(input) {
    const taskId = input["task_id"] as string;

    const task = backgroundTaskRegistry.get(taskId);
    if (!task) {
      logger.tool.warn("TaskStop: tarefa não encontrada", { taskId });
      return JSON.stringify({
        success: false,
        error: `Task not found: "${taskId}". Only tasks started in the current session are tracked.`,
      });
    }

    if (task.status !== "running") {
      logger.tool.warn("TaskStop: tarefa não está em execução", { taskId, status: task.status });
      return JSON.stringify({
        success: false,
        error: `Task "${taskId}" is not running (status: ${task.status}).`,
      });
    }

    task.status = "stopped";
    task.controller.abort();
    logger.tool.info("TaskStop: tarefa parada", { taskId, description: task.description, type: task.type });

    return JSON.stringify({
      success: true,
      task_id: taskId,
      description: task.description,
      message: `Task "${task.description}" (${taskId}) has been stopped.`,
    });
  },
};
