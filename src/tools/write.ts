import fs from "fs";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";

export const writeTool: ToolDefinition = {
  name: "Write",
  description:
    "Write content to a file, creating it (and any parent directories) if it doesn't exist, or overwriting it if it does. Use Edit for partial changes to existing files.",
  input_schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute or relative path to the file to write",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },
  async execute(input) {
    const filePath = path.resolve(input["file_path"] as string);
    const content = input["content"] as string;

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf-8");
      const lines = content.split("\n").length;
      return `${lines} linhas escritas em ${filePath}`;
    } catch (err) {
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
