import fs from "fs";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";
import { validateFilePath } from "./_pathSafety.ts";

const MAX_LINES = 2000;
const MAX_CHARS = 100_000;

export const readTool: ToolDefinition = {
  name: "Read",
  description:
    "Read a file from the filesystem. Returns the file contents with line numbers. You must read a file before editing it.",
  input_schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute or relative path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read",
      },
    },
    required: ["file_path"],
  },
  async execute(input) {
    const filePath = path.resolve(input["file_path"] as string);
    const offset = ((input["offset"] as number | undefined) ?? 1) - 1;
    const limit = (input["limit"] as number | undefined) ?? MAX_LINES;

    try { validateFilePath(filePath); } catch (err) {
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }

    logger.tool.debug("Read: lendo arquivo", { filePath, offset: offset + 1, limit });

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      logger.tool.warn("Read: arquivo não encontrado ou inacessível", { filePath, error: err instanceof Error ? err.message : String(err) });
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }

    const allLines = content.split("\n");
    const selected = allLines.slice(offset, offset + limit);

    let result = selected
      .map((line, i) => `${String(i + offset + 1).padStart(6)}→${line}`)
      .join("\n");

    const truncated = result.length > MAX_CHARS;
    if (truncated) {
      result = result.slice(0, MAX_CHARS) + "\n[truncado]";
    }

    logger.tool.debug("Read: arquivo lido", { filePath, totalLines: allLines.length, selectedLines: selected.length, truncated });

    return result;
  },
};
