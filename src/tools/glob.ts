import { execSync } from "child_process";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";

export const globTool: ToolDefinition = {
  name: "Glob",
  description:
    "Find files matching a glob pattern. Returns matching file paths, ignoring node_modules and .git.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.tsx"',
      },
      path: {
        type: "string",
        description: "Directory to search in (default: current working directory)",
      },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const pattern = input["pattern"] as string;
    const searchPath = path.resolve((input["path"] as string | undefined) ?? process.cwd());

    try {
      // Convert glob pattern to find-compatible: ** → *, use -name for simple patterns
      const safePath = searchPath.replace(/'/g, "'\\''");
      const safePattern = pattern.split("/").pop()!.replace(/'/g, "'\\''");

      const result = execSync(
        `find '${safePath}' -name '${safePattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null`,
        { encoding: "utf-8", timeout: 10_000 }
      );

      const lines = result.trim().split("\n").filter(Boolean);
      if (lines.length === 0) return "Nenhum arquivo encontrado com o padrão.";
      return lines.slice(0, 200).join("\n");
    } catch (err) {
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
