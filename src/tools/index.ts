import type { ToolDefinition } from "../lib/types.ts";
import { bashTool } from "./bash.ts";
import { readTool } from "./read.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { agentTool } from "./agent.ts";
import { taskOutputTool } from "./taskOutput.ts";
import { webFetchTool } from "./webfetch.ts";
import { webSearchTool } from "./websearch.ts";
import { notebookEditTool, notebookReadTool } from "./notebook.ts";
import { taskCreateTool, taskUpdateTool, taskGetTool, taskListTool } from "./task.ts";
import { skillTool } from "./skill.ts";
import { enterPlanModeTool, exitPlanModeTool } from "./planMode.ts";
import { enterWorktreeTool } from "./worktree.ts";
import { updateMemoryTool, appendMemoryTool } from "./memory.ts";
import { multiEditTool } from "./multiEdit.ts";
import { askUserQuestionTool } from "./askUser.ts";
import { integrationActionTool, integrationListTool } from "./integration.ts";
import { gitTool } from "./git.ts";

const toolRegistry: ToolDefinition[] = [
  // File operations
  readTool,
  writeTool,
  editTool,
  multiEditTool,
  globTool,
  grepTool,
  notebookEditTool,
  notebookReadTool,
  // Shell
  bashTool,
  // Web
  webFetchTool,
  webSearchTool,
  // Task management (replaces TodoWrite/TodoRead)
  taskCreateTool,
  taskUpdateTool,
  taskGetTool,
  taskListTool,
  // Plan mode
  enterPlanModeTool,
  exitPlanModeTool,
  // Skills
  skillTool,
  // Worktree
  enterWorktreeTool,
  // Memory
  updateMemoryTool,
  appendMemoryTool,
  // Subagents
  agentTool,
  taskOutputTool,
  // User interaction
  askUserQuestionTool,
  // Integrations
  integrationActionTool,
  integrationListTool,
  // Git
  gitTool,
];

export function getAllTools(): ToolDefinition[] {
  return toolRegistry;
}

export function registerTool(tool: ToolDefinition): void {
  // Avoid duplicates by name
  const existing = toolRegistry.findIndex((t) => t.name === tool.name);
  if (existing !== -1) {
    toolRegistry[existing] = tool;
  } else {
    toolRegistry.push(tool);
  }
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.find((t) => t.name === name);
}
