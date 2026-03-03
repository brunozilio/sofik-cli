import { execSync } from "child_process";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";

const MAX_RESULTS = 100;

export const grepTool: ToolDefinition = {
  name: "Grep",
  description:
    "Search for a regex pattern in file contents. Returns matching lines with file paths and line numbers.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression pattern to search for",
      },
      path: {
        type: "string",
        description: "File or directory to search in (default: cwd)",
      },
      glob: {
        type: "string",
        description: 'File glob filter, e.g. "*.ts" or "**/*.tsx"',
      },
      case_insensitive: {
        type: "boolean",
        description: "Case-insensitive search (default: false)",
      },
      context: {
        type: "number",
        description: "Lines of context around each match",
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "Output mode (default: files_with_matches)",
      },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const pattern = input["pattern"] as string;
    const searchPath = (input["path"] as string | undefined) ?? process.cwd();
    const glob = input["glob"] as string | undefined;
    const caseInsensitive = (input["case_insensitive"] as boolean) ?? false;
    const context = input["context"] as number | undefined;
    const outputMode =
      (input["output_mode"] as string | undefined) ?? "files_with_matches";

    const flags: string[] = ["-r", "--include=*"];
    if (caseInsensitive) flags.push("-i");
    if (glob) flags.push(`--include=${glob}`);
    if (outputMode === "files_with_matches") flags.push("-l");
    if (outputMode === "count") flags.push("-c");
    if (context !== undefined) flags.push(`-C${context}`);
    if (outputMode === "content") flags.push("-n");

    // Exclude noise
    flags.push("--exclude-dir=node_modules", "--exclude-dir=.git");

    const cmd = `grep ${flags.join(" ")} ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -${MAX_RESULTS}`;

    logger.tool.debug("Grep: buscando padrão", { pattern, searchPath, glob, outputMode });

    try {
      const result = execSync(cmd, { encoding: "utf-8" });
      const lines = result.trim().split("\n").filter(Boolean);
      logger.tool.debug("Grep: resultado", { pattern, matchCount: lines.length, limited: lines.length >= MAX_RESULTS });
      if (lines.length === 0) return "Nenhuma correspondência encontrada.";
      const suffix = lines.length >= MAX_RESULTS ? `\n[limitado a ${MAX_RESULTS} resultados]` : "";
      return lines.join("\n") + suffix;
    } catch (err: unknown) {
      // grep exits with code 1 when no matches
      const e = err as { status?: number; stdout?: string };
      if (e.status === 1) return "Nenhuma correspondência encontrada.";
      logger.tool.warn("Grep: erro", { pattern, error: err instanceof Error ? err.message : String(err) });
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
