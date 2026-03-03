import fs from "fs";
import path, { resolve } from "path";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";

interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  source: string | string[];
  outputs?: unknown[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
}

function cellSource(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join("") : cell.source;
}

function setSource(cell: NotebookCell, src: string): void {
  cell.source = src.split("\n").map((l, i, arr) => l + (i < arr.length - 1 ? "\n" : ""));
}

export const notebookEditTool: ToolDefinition = {
  name: "NotebookEdit",
  description:
    "Read or edit cells in a Jupyter notebook (.ipynb). Can replace a cell's content, insert a new cell, or delete a cell. Use cell_number (0-indexed) to target cells.",
  input_schema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "Absolute or relative path to the .ipynb file",
      },
      cell_number: {
        type: "number",
        description: "0-indexed cell number to operate on",
      },
      new_source: {
        type: "string",
        description: "New source content for the cell (required for replace/insert)",
      },
      cell_type: {
        type: "string",
        enum: ["code", "markdown"],
        description: "Cell type when inserting (default: code)",
      },
      edit_mode: {
        type: "string",
        enum: ["replace", "insert", "delete", "read"],
        description: "Operation: replace (default), insert after cell_number, delete, or read all cells",
      },
    },
    required: ["notebook_path"],
  },
  async execute(input) {
    const nbPath = path.resolve(input["notebook_path"] as string);
    const editMode = (input["edit_mode"] as string | undefined) ?? "replace";
    const cellNumber = input["cell_number"] as number | undefined;
    const newSource = input["new_source"] as string | undefined;
    const cellType = (input["cell_type"] as "code" | "markdown" | undefined) ?? "code";

    const t0 = Date.now();
    logger.tool.info("NotebookEdit iniciado", { nbPath, editMode, cellNumber });

    let nb: Notebook;
    try {
      const raw = fs.readFileSync(nbPath, "utf-8");
      nb = JSON.parse(raw) as Notebook;
    } catch (err) {
      logger.tool.error("NotebookEdit falhou ao ler", { nbPath, error: err instanceof Error ? err.message : String(err) });
      return `Error reading notebook: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (editMode === "read") {
      logger.tool.info("NotebookEdit leitura concluída", { nbPath, cellCount: nb.cells.length, durationMs: Date.now() - t0 });
      return nb.cells
        .map((c, i) => {
          const src = cellSource(c);
          return `[${i}] ${c.cell_type.toUpperCase()}\n${src}`;
        })
        .join("\n\n---\n\n");
    }

    if (cellNumber === undefined) {
      return "Erro: cell_number é obrigatório para replace/insert/delete";
    }

    if (editMode === "delete") {
      if (cellNumber < 0 || cellNumber >= nb.cells.length) {
        return `Erro: cell_number ${cellNumber} fora do intervalo (0-${nb.cells.length - 1})`;
      }
      nb.cells.splice(cellNumber, 1);
    } else if (editMode === "insert") {
      if (!newSource) return "Erro: new_source é obrigatório para insert";
      const newCell: NotebookCell = {
        cell_type: cellType,
        id: Math.random().toString(36).slice(2, 10),
        source: newSource,
        outputs: cellType === "code" ? [] : undefined,
        execution_count: cellType === "code" ? null : undefined,
        metadata: {},
      };
      nb.cells.splice(cellNumber + 1, 0, newCell);
    } else {
      // replace
      if (!newSource) return "Erro: new_source é obrigatório para replace";
      if (cellNumber < 0 || cellNumber >= nb.cells.length) {
        return `Erro: cell_number ${cellNumber} fora do intervalo (0-${nb.cells.length - 1})`;
      }
      const cell = nb.cells[cellNumber]!;
      setSource(cell, newSource);
      if (cellType) cell.cell_type = cellType;
      // Clear outputs on edit
      if (cell.cell_type === "code") {
        cell.outputs = [];
        cell.execution_count = null;
      }
    }

    try {
      fs.writeFileSync(nbPath, JSON.stringify(nb, null, 1), "utf-8");
      logger.tool.info("NotebookEdit concluído", { nbPath, editMode, cellNumber, cellCount: nb.cells.length, durationMs: Date.now() - t0 });
      return `Notebook atualizado: ${nbPath} (${nb.cells.length} células)`;
    } catch (err) {
      logger.tool.error("NotebookEdit falhou ao escrever", { nbPath, error: err instanceof Error ? err.message : String(err) });
      return `Erro ao escrever notebook: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const notebookReadTool: ToolDefinition = {
  name: "NotebookRead",
  description: "Read a Jupyter notebook file (.ipynb) and return its cells with outputs. Returns { cells: [{ cell_type, source, outputs }] }",
  input_schema: {
    type: "object",
    properties: {
      notebook_path: {
        type: "string",
        description: "The absolute path to the Jupyter notebook file to read",
      },
    },
    required: ["notebook_path"],
  },
  async execute(input) {
    const notebookPath = resolve(input["notebook_path"] as string);

    let raw: string;
    try {
      raw = await Bun.file(notebookPath).text();
    } catch {
      throw new Error(`Could not read notebook: ${notebookPath}`);
    }

    let nb: {
      cells?: Array<{
        cell_type: string;
        source: string | string[];
        outputs?: Array<{
          output_type: string;
          text?: string | string[];
          data?: Record<string, string | string[]>;
          name?: string;
          ename?: string;
          evalue?: string;
        }>;
      }>;
    };

    try {
      nb = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON in notebook: ${notebookPath}`);
    }

    const cells = (nb.cells ?? []).map((cell) => {
      const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source ?? "");

      const outputs = (cell.outputs ?? []).map((out) => {
        if (out.output_type === "stream") {
          const text = Array.isArray(out.text) ? out.text.join("") : (out.text ?? "");
          return { type: "stream", name: out.name ?? "stdout", text };
        }
        if (out.output_type === "error") {
          return { type: "error", ename: out.ename, evalue: out.evalue };
        }
        // display_data or execute_result
        const data = out.data ?? {};
        const text = (() => {
          if (data["text/plain"]) {
            return Array.isArray(data["text/plain"]) ? data["text/plain"].join("") : data["text/plain"];
          }
          if (data["text/html"]) {
            const html = Array.isArray(data["text/html"]) ? data["text/html"].join("") : data["text/html"];
            // Strip HTML tags for plain text display
            return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
          }
          return "";
        })();
        return { type: out.output_type, text };
      });

      return {
        cell_type: cell.cell_type,
        source,
        outputs: cell.cell_type === "code" ? outputs : [],
      };
    });

    return JSON.stringify({ cells }, null, 2);
  },
};
