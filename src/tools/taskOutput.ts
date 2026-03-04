import type { ToolDefinition } from "../lib/types.ts";
import { agentRegistry } from "./agent.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const taskOutputTool: ToolDefinition = {
  name: "TaskOutput",
  description: `Retrieves output from a running or completed background agent.
- Takes a task_id parameter identifying the agent (returned by Agent with run_in_background: true)
- Returns the agent's output along with status information
- Use block: true (default) to wait for agent completion
- Use block: false for a non-blocking check of current status
- Task IDs start with 'a' followed by hex digits (e.g. "a3f2b1c4...")`,
  input_schema: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The agent ID to get output from (returned by Agent tool)",
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

    const state = agentRegistry.get(taskId);
    if (!state) {
      return JSON.stringify({
        error: `Agent not found: "${taskId}". Only agents started in the current session are tracked.`,
      });
    }

    if (block && state.status === "running") {
      await Promise.race([state.promise, sleep(timeoutMs)]);
    }

    // Re-read after potential await
    const current = agentRegistry.get(taskId)!;
    return JSON.stringify({
      task_id: taskId,
      status: current.status,
      output: current.output,
      outputFile: current.outputFile,
      transcriptFile: current.transcriptFile,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
    });
  },
};
