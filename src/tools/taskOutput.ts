import type { ToolDefinition } from "../lib/types.ts";
import { backgroundTaskRegistry } from "../lib/backgroundTasks.ts";
import { logger } from "../lib/logger.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const taskOutputTool: ToolDefinition = {
  name: "TaskOutput",
  description: `Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`,
  input_schema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The task ID to get output from",
      },
      block: {
        type: "boolean",
        description: "Whether to wait for completion (default: true)",
      },
      timeout: {
        type: "number",
        description: "Max wait time in ms when block is true (default: 30000, max: 600000)",
      },
    },
    required: ["task_id"],
  },
  async execute(input) {
    const taskId = input["task_id"] as string;
    const block = (input["block"] as boolean | undefined) ?? true;
    const timeoutMs = Math.min(
      (input["timeout"] as number | undefined) ?? 30_000,
      600_000
    );

    const task = backgroundTaskRegistry.get(taskId);
    if (!task) {
      logger.tool.warn("TaskOutput: tarefa não encontrada", { taskId });
      return JSON.stringify({
        error: `Task not found: "${taskId}". Only tasks started in the current session are tracked.`,
      });
    }

    logger.tool.info("TaskOutput: consultando tarefa", { taskId, status: task.status, block, timeoutMs });

    if (block && task.status === "running") {
      await Promise.race([task.promise, sleep(timeoutMs)]);
    }

    // Re-read after potential await
    const current = backgroundTaskRegistry.get(taskId)!;
    logger.tool.info("TaskOutput: resultado retornado", { taskId, status: current.status, outputLength: current.partialOutput.length });
    return JSON.stringify({
      task_id: taskId,
      type: current.type,
      status: current.status,
      output: current.partialOutput,
      outputFile: current.outputFile,
      transcriptFile: current.transcriptFile,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
    });
  },
};
