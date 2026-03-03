import fs from "fs";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";

export const editTool: ToolDefinition = {
  name: "Edit",
  description:
    "Replace an exact string in a file. The old_string must match exactly (including whitespace and indentation). Always read the file first to get the exact content.",
  input_schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description:
          "The exact string to find and replace. Must be unique in the file.",
      },
      new_string: {
        type: "string",
        description: "The string to replace old_string with",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },
  async execute(input) {
    const filePath = path.resolve(input["file_path"] as string);
    const oldString = input["old_string"] as string;
    const newString = input["new_string"] as string;
    const replaceAll = (input["replace_all"] as boolean | undefined) ?? false;

    logger.tool.info("Edit: editando arquivo", { filePath, replaceAll, oldLength: oldString.length, newLength: newString.length });

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      logger.tool.error("Edit: falha ao ler arquivo", { filePath, error: err instanceof Error ? err.message : String(err) });
      return `Erro ao ler arquivo: ${err instanceof Error ? err.message : String(err)}`;
    }

    const count = content.split(oldString).length - 1;

    if (count === 0) {
      logger.tool.warn("Edit: old_string não encontrado", { filePath, oldStringPreview: oldString.slice(0, 80) });
      return `Erro: old_string não encontrado no arquivo. Certifique-se de ler o arquivo primeiro e copiar o texto exato.`;
    }

    if (!replaceAll && count > 1) {
      logger.tool.warn("Edit: old_string ambíguo", { filePath, occurrences: count });
      return `Erro: old_string aparece ${count} vezes no arquivo. Torne-o único incluindo mais contexto, ou use replace_all: true.`;
    }

    let result: string;
    if (replaceAll) {
      result = content.split(oldString).join(newString);
    } else {
      result = content.replace(oldString, newString);
    }

    try {
      fs.writeFileSync(filePath, result, "utf-8");
      const addedCount = newString.split("\n").length;
      const removedCount = oldString.split("\n").length;
      logger.tool.info("Edit: arquivo editado", { filePath, occurrences: count, addedLines: addedCount, removedLines: removedCount });
      const diffLines = [
        ...oldString.split("\n").map((l) => `- ${l}`),
        ...newString.split("\n").map((l) => `+ ${l}`),
      ];
      // Limit diff display to 20 lines total
      const diffPreview = diffLines.slice(0, 20).join("\n") +
        (diffLines.length > 20 ? `\n... (${diffLines.length - 20} linhas a mais)` : "");
      return `Arquivo ${path.basename(filePath)} editado com sucesso\n__DIFF__\n${diffPreview}\n__END_DIFF__`;
    } catch (err) {
      logger.tool.error("Edit: falha ao escrever arquivo", { filePath, error: err instanceof Error ? err.message : String(err) });
      return `Erro ao escrever arquivo: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
