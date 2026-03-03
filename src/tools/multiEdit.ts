import fs from "fs";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";

interface EditOperation {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const multiEditTool: ToolDefinition = {
  name: "MultiEdit",
  description:
    "Apply multiple string replacements across one or more files in a single operation. " +
    "More efficient than calling Edit repeatedly when refactoring across files. " +
    "All edits for the same file are applied atomically (file read once, written once). " +
    "Each old_string must be unique in its file (or use replace_all: true).",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "List of edit operations to perform",
        items: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Path to the file to edit" },
            old_string: { type: "string", description: "Exact string to find (must be unique unless replace_all is true)" },
            new_string: { type: "string", description: "Replacement string" },
            replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" },
          },
          required: ["file_path", "old_string", "new_string"],
        },
      },
    },
    required: ["edits"],
  },
  async execute(input) {
    const edits = input["edits"] as EditOperation[];
    if (!Array.isArray(edits) || edits.length === 0) {
      return "Erro: edits deve ser um array não vazio";
    }

    logger.tool.info("MultiEdit: iniciando edições em lote", { editCount: edits.length, files: [...new Set(edits.map(e => e.file_path))] });

    // Group edits by file path
    const byFile = new Map<string, EditOperation[]>();
    for (const edit of edits) {
      const resolved = path.resolve(edit.file_path);
      if (!byFile.has(resolved)) byFile.set(resolved, []);
      byFile.get(resolved)!.push({ ...edit, file_path: resolved });
    }

    const results: string[] = [];

    for (const [filePath, fileEdits] of byFile) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch (err) {
        results.push(`Erro ao ler ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      let fileOk = true;
      for (const edit of fileEdits) {
        const count = content.split(edit.old_string).length - 1;
        if (count === 0) {
          results.push(`Erro em ${filePath}: old_string não encontrado: ${edit.old_string.slice(0, 60)}…`);
          fileOk = false;
          break;
        }
        if (!edit.replace_all && count > 1) {
          results.push(`Erro em ${filePath}: old_string aparece ${count} vezes. Use replace_all: true ou torne-o único.`);
          fileOk = false;
          break;
        }
        if (edit.replace_all) {
          content = content.split(edit.old_string).join(edit.new_string);
        } else {
          content = content.replace(edit.old_string, edit.new_string);
        }
      }

      if (!fileOk) continue;

      try {
        fs.writeFileSync(filePath, content, "utf-8");
        logger.tool.info("MultiEdit: arquivo atualizado", { filePath, editCount: fileEdits.length });
        results.push(`✓ ${filePath} (${fileEdits.length} edição${fileEdits.length > 1 ? "s" : ""})`);
      } catch (err) {
        logger.tool.error("MultiEdit: falha ao escrever", { filePath, error: err instanceof Error ? err.message : String(err) });
        results.push(`Erro ao escrever ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results.join("\n");
  },
};
