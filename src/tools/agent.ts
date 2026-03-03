import type { ToolDefinition } from "../lib/types.ts";
import { buildSystemPrompt } from "../lib/systemPrompt.ts";
import { loadProjectMemory } from "../lib/session.ts";
import { getAllTools } from "./index.ts";
import { getActiveTasks } from "./task.ts";
import { getCurrentModel } from "../lib/anthropic.ts";
import { streamResponse } from "../lib/providers/index.ts";
import type { Message } from "../lib/types.ts";

/**
 * Spawns a subagent: a fresh Claude instance with its own conversation loop.
 * Used for parallel or isolated subtasks that shouldn't pollute the main context.
 * Goes through the generic provider system — works with any configured provider.
 */
export const agentTool: ToolDefinition = {
  name: "Agent",
  description: `Launch a subagent to handle a complex, multi-step subtask autonomously.
Use this when a task is independent enough to be delegated, or when you want to
protect the main context window from large outputs. The subagent has access to
all the same tools (Bash, Read, Write, Edit, Glob, Grep). It runs synchronously
and returns its final output.

When NOT to use: for simple single-tool calls — just call the tool directly.`,
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "3-5 word summary of the subagent's task",
      },
      prompt: {
        type: "string",
        description:
          "The full task description for the subagent. Be specific and self-contained — the subagent has no context from the main conversation.",
      },
      inherit_context: {
        type: "boolean",
        description: "When true, inject parent session context (project memory, active tasks) into the subagent's system prompt",
      },
    },
    required: ["description", "prompt"],
  },
  async execute(input) {
    const prompt = input["prompt"] as string;
    const description = input["description"] as string;
    const inheritContext = input["inherit_context"] as boolean | undefined;

    // Build system prompt for the subagent
    let systemPrompt = buildSystemPrompt();

    if (inheritContext) {
      const parts: string[] = [];
      const memory = loadProjectMemory();
      if (memory) parts.push(`Project memory:\n${memory}`);
      const activeTasks = getActiveTasks();
      if (activeTasks.length > 0) {
        parts.push(`Active tasks:\n${activeTasks.map(t => `- [${t.id}] ${t.subject} (${t.status})`).join("\n")}`);
      }
      if (parts.length > 0) {
        systemPrompt += `\n\n<parent_context>\n${parts.join("\n\n")}\n</parent_context>`;
      }
    }

    systemPrompt += `\n\n<subagent_context>You are a subagent handling the task: "${description}". Complete it and return your findings.</subagent_context>`;

    const tools = getAllTools().filter((t) => t.name !== "Agent");
    const messages: Message[] = [{ role: "user", content: prompt }];

    let output = "";
    for await (const chunk of streamResponse({
      model: getCurrentModel(),
      messages,
      tools,
      systemOverride: systemPrompt,
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      output += chunk;
    }

    return output || "(subagente completou sem texto de saída)";
  },
};
