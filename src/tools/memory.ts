import fs from "fs";
import type { ToolDefinition } from "../lib/types.ts";
import { ensureProjectMemoryPath } from "../lib/session.ts";

export const updateMemoryTool: ToolDefinition = {
  name: "UpdateMemory",
  description:
    "Update or replace a section in the project MEMORY.md file. " +
    "MEMORY.md persists across sessions and is always loaded into the system prompt. " +
    "Use this to save important discoveries, patterns, decisions, and user preferences. " +
    "Use AppendMemory to add new content, UpdateMemory to replace existing sections.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The new content for MEMORY.md (full file replacement)",
      },
    },
    required: ["content"],
  },
  async execute(input) {
    const content = input["content"] as string;
    try {
      const memPath = ensureProjectMemoryPath();
      fs.writeFileSync(memPath, content, "utf-8");
      return `Memória atualizada: ${memPath}`;
    } catch (err) {
      return `Erro ao atualizar memória: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const appendMemoryTool: ToolDefinition = {
  name: "AppendMemory",
  description:
    "Append a note or section to the project MEMORY.md file. " +
    "Use for adding new information without replacing existing content. " +
    "For replacing a section, use UpdateMemory instead.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Text to append to MEMORY.md",
      },
    },
    required: ["content"],
  },
  async execute(input) {
    const content = input["content"] as string;
    try {
      const memPath = ensureProjectMemoryPath();
      const existing = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf-8") : "";
      const separator = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
      fs.writeFileSync(memPath, existing + separator + content, "utf-8");
      return `Memória adicionada: ${memPath}`;
    } catch (err) {
      return `Erro ao adicionar à memória: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
