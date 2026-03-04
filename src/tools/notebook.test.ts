import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { notebookEditTool, notebookReadTool } from "./notebook.ts";

// ── Temp dir setup ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-notebook-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeNotebook(cells: Array<{ type: "code" | "markdown" | "raw"; source: string | string[] }>) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: cells.map((c, i) => ({
      cell_type: c.type,
      id: `cell-${i}`,
      source: c.source,
      outputs: c.type === "code" ? [] : undefined,
      execution_count: c.type === "code" ? null : undefined,
      metadata: {},
    })),
  };
}

function writeNotebook(name: string, nb: object): string {
  const nbPath = path.join(tmpDir, name);
  fs.writeFileSync(nbPath, JSON.stringify(nb, null, 2), "utf-8");
  return nbPath;
}

function readNotebook(nbPath: string) {
  return JSON.parse(fs.readFileSync(nbPath, "utf-8"));
}

async function editTool(input: Record<string, unknown>): Promise<string> {
  return notebookEditTool.execute!(input) as Promise<string>;
}

async function readTool(input: Record<string, unknown>): Promise<string> {
  return notebookReadTool.execute!(input) as Promise<string>;
}

// ── notebookEditTool metadata ────────────────────────────────────────────────

describe("notebookEditTool metadata", () => {
  test("name is 'NotebookEdit'", () => {
    expect(notebookEditTool.name).toBe("NotebookEdit");
  });

  test("has a description", () => {
    expect(typeof notebookEditTool.description).toBe("string");
    expect(notebookEditTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof notebookEditTool.execute).toBe("function");
  });

  test("requires notebook_path", () => {
    expect(notebookEditTool.input_schema.required).toContain("notebook_path");
  });
});

// ── notebookEditTool — read mode ─────────────────────────────────────────────

describe("notebookEditTool — edit_mode: read", () => {
  test("returns formatted cell list", async () => {
    const nbPath = writeNotebook("read-test.ipynb", makeNotebook([
      { type: "markdown", source: "# Title" },
      { type: "code", source: "print('hello')" },
    ]));

    const result = await editTool({ notebook_path: nbPath, edit_mode: "read" });
    expect(result).toContain("MARKDOWN");
    expect(result).toContain("# Title");
    expect(result).toContain("CODE");
    expect(result).toContain("print('hello')");
  });

  test("uses [N] index prefix for each cell", async () => {
    const nbPath = writeNotebook("read-index.ipynb", makeNotebook([
      { type: "code", source: "x = 1" },
      { type: "code", source: "y = 2" },
    ]));

    const result = await editTool({ notebook_path: nbPath, edit_mode: "read" });
    expect(result).toContain("[0]");
    expect(result).toContain("[1]");
  });

  test("joins array source into a single string", async () => {
    const nbPath = writeNotebook("read-array-source.ipynb", makeNotebook([
      { type: "code", source: ["line1\n", "line2\n", "line3"] },
    ]));

    const result = await editTool({ notebook_path: nbPath, edit_mode: "read" });
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).toContain("line3");
  });

  test("returns empty-ish result for notebook with no cells", async () => {
    const nb = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
    const nbPath = writeNotebook("empty.ipynb", nb);
    const result = await editTool({ notebook_path: nbPath, edit_mode: "read" });
    expect(typeof result).toBe("string");
    expect(result).toBe(""); // map over empty array → ""
  });
});

// ── notebookEditTool — replace mode ─────────────────────────────────────────

describe("notebookEditTool — edit_mode: replace (default)", () => {
  test("replaces source of target cell", async () => {
    const nbPath = writeNotebook("replace.ipynb", makeNotebook([
      { type: "code", source: "old code" },
      { type: "markdown", source: "Keep me" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      cell_number: 0,
      new_source: "new code",
    });
    expect(result).toContain("Notebook atualizado");

    const nb = readNotebook(nbPath);
    const src = nb.cells[0].source;
    const joined = Array.isArray(src) ? src.join("") : src;
    expect(joined).toBe("new code");
  });

  test("clears outputs and execution_count for code cells", async () => {
    const nb = makeNotebook([{ type: "code", source: "x = 1" }]);
    (nb.cells[0] as Record<string, unknown>).outputs = [{ type: "stream", text: "1" }];
    (nb.cells[0] as Record<string, unknown>).execution_count = 5;
    const nbPath = writeNotebook("clear-outputs.ipynb", nb);

    await editTool({ notebook_path: nbPath, cell_number: 0, new_source: "x = 2" });

    const saved = readNotebook(nbPath);
    expect(saved.cells[0].outputs).toEqual([]);
    expect(saved.cells[0].execution_count).toBeNull();
  });

  test("replaces cell type when cellType is provided", async () => {
    const nbPath = writeNotebook("change-type.ipynb", makeNotebook([
      { type: "code", source: "code here" },
    ]));

    await editTool({
      notebook_path: nbPath,
      cell_number: 0,
      new_source: "# Markdown",
      cell_type: "markdown",
    });

    const saved = readNotebook(nbPath);
    expect(saved.cells[0].cell_type).toBe("markdown");
  });

  test("returns error when cell_number is undefined for replace", async () => {
    const nbPath = writeNotebook("no-cell-num.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      new_source: "y",
      // no cell_number
    });
    expect(result).toContain("Erro");
    expect(result).toContain("cell_number");
  });

  test("returns error when new_source is missing for replace", async () => {
    const nbPath = writeNotebook("no-source.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      cell_number: 0,
      // no new_source
    });
    expect(result).toContain("Erro");
  });

  test("returns error when cell_number is out of range", async () => {
    const nbPath = writeNotebook("oob-replace.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      cell_number: 5,
      new_source: "y",
    });
    expect(result).toContain("Erro");
    expect(result).toContain("fora do intervalo");
  });

  test("returns error for negative cell_number", async () => {
    const nbPath = writeNotebook("neg-cell.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      cell_number: -1,
      new_source: "y",
    });
    expect(result).toContain("Erro");
  });
});

// ── notebookEditTool — insert mode ────────────────────────────────────────────

describe("notebookEditTool — edit_mode: insert", () => {
  test("inserts a new code cell after cell_number", async () => {
    const nbPath = writeNotebook("insert.ipynb", makeNotebook([
      { type: "code", source: "cell0" },
      { type: "code", source: "cell1" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      edit_mode: "insert",
      cell_number: 0,
      new_source: "inserted",
    });
    expect(result).toContain("Notebook atualizado");

    const saved = readNotebook(nbPath);
    expect(saved.cells).toHaveLength(3);
    const src = saved.cells[1].source;
    const joined = typeof src === "string" ? src : src.join("");
    expect(joined).toBe("inserted");
  });

  test("inserted code cell has empty outputs and null execution_count", async () => {
    const nbPath = writeNotebook("insert-outputs.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    await editTool({
      notebook_path: nbPath,
      edit_mode: "insert",
      cell_number: 0,
      new_source: "new cell",
      cell_type: "code",
    });

    const saved = readNotebook(nbPath);
    const newCell = saved.cells[1];
    expect(newCell.cell_type).toBe("code");
    expect(newCell.outputs).toEqual([]);
    expect(newCell.execution_count).toBeNull();
  });

  test("inserted markdown cell has no outputs or execution_count", async () => {
    const nbPath = writeNotebook("insert-md.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    await editTool({
      notebook_path: nbPath,
      edit_mode: "insert",
      cell_number: 0,
      new_source: "## Section",
      cell_type: "markdown",
    });

    const saved = readNotebook(nbPath);
    const newCell = saved.cells[1];
    expect(newCell.cell_type).toBe("markdown");
    expect(newCell.outputs).toBeUndefined();
    expect(newCell.execution_count).toBeUndefined();
  });

  test("inserted cell has a random id", async () => {
    const nbPath = writeNotebook("insert-id.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    await editTool({
      notebook_path: nbPath,
      edit_mode: "insert",
      cell_number: 0,
      new_source: "y",
    });

    const saved = readNotebook(nbPath);
    expect(typeof saved.cells[1].id).toBe("string");
    expect(saved.cells[1].id.length).toBeGreaterThan(0);
  });

  test("returns error when new_source is missing for insert", async () => {
    const nbPath = writeNotebook("insert-no-src.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      edit_mode: "insert",
      cell_number: 0,
      // no new_source
    });
    expect(result).toContain("Erro");
    expect(result).toContain("new_source");
  });
});

// ── notebookEditTool — delete mode ────────────────────────────────────────────

describe("notebookEditTool — edit_mode: delete", () => {
  test("deletes the specified cell", async () => {
    const nbPath = writeNotebook("delete.ipynb", makeNotebook([
      { type: "code", source: "cell0" },
      { type: "markdown", source: "cell1" },
      { type: "code", source: "cell2" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      edit_mode: "delete",
      cell_number: 1,
    });
    expect(result).toContain("Notebook atualizado");

    const saved = readNotebook(nbPath);
    expect(saved.cells).toHaveLength(2);
    const src0 = saved.cells[0].source;
    expect(typeof src0 === "string" ? src0 : src0.join("")).toContain("cell0");
  });

  test("returns error when deleting out-of-range cell", async () => {
    const nbPath = writeNotebook("delete-oob.ipynb", makeNotebook([
      { type: "code", source: "only" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      edit_mode: "delete",
      cell_number: 3,
    });
    expect(result).toContain("Erro");
    expect(result).toContain("fora do intervalo");
  });

  test("returns error when cell_number is undefined for delete", async () => {
    const nbPath = writeNotebook("delete-no-num.ipynb", makeNotebook([
      { type: "code", source: "x" },
    ]));

    const result = await editTool({
      notebook_path: nbPath,
      edit_mode: "delete",
      // no cell_number
    });
    expect(result).toContain("Erro");
  });
});

// ── notebookEditTool — error paths ───────────────────────────────────────────

describe("notebookEditTool — error paths", () => {
  test("returns error when notebook file does not exist", async () => {
    const result = await editTool({
      notebook_path: path.join(tmpDir, "nonexistent.ipynb"),
      edit_mode: "read",
    });
    expect(result).toContain("Error");
  });

  test("returns error when notebook contains invalid JSON", async () => {
    const badPath = path.join(tmpDir, "bad.ipynb");
    fs.writeFileSync(badPath, "{ not valid json }", "utf-8");

    const result = await editTool({ notebook_path: badPath, edit_mode: "read" });
    expect(result).toContain("Error");
  });
});

// ── notebookReadTool metadata ─────────────────────────────────────────────────

describe("notebookReadTool metadata", () => {
  test("name is 'NotebookRead'", () => {
    expect(notebookReadTool.name).toBe("NotebookRead");
  });

  test("has a description", () => {
    expect(typeof notebookReadTool.description).toBe("string");
    expect(notebookReadTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof notebookReadTool.execute).toBe("function");
  });

  test("requires notebook_path", () => {
    expect(notebookReadTool.input_schema.required).toContain("notebook_path");
  });
});

// ── notebookReadTool — execute ────────────────────────────────────────────────

describe("notebookReadTool — execute", () => {
  test("returns JSON string with cells array", async () => {
    const nbPath = writeNotebook("read-tool.ipynb", makeNotebook([
      { type: "code", source: "x = 1" },
    ]));

    const result = await readTool({ notebook_path: nbPath });
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed.cells)).toBe(true);
    expect(parsed.cells).toHaveLength(1);
  });

  test("cell has cell_type, source, and outputs fields", async () => {
    const nbPath = writeNotebook("read-fields.ipynb", makeNotebook([
      { type: "code", source: "x = 1" },
    ]));

    const result = await readTool({ notebook_path: nbPath });
    const { cells } = JSON.parse(result);
    expect(cells[0]).toHaveProperty("cell_type");
    expect(cells[0]).toHaveProperty("source");
    expect(cells[0]).toHaveProperty("outputs");
  });

  test("joins array source into a string", async () => {
    const nbPath = writeNotebook("read-array.ipynb", makeNotebook([
      { type: "code", source: ["import os\n", "print(os.getcwd())"] },
    ]));

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].source).toContain("import os");
  });

  test("returns empty cells array for notebook with no cells", async () => {
    const nb = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
    const nbPath = writeNotebook("read-empty.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells).toHaveLength(0);
  });

  test("markdown cells have empty outputs array", async () => {
    const nbPath = writeNotebook("read-md-outputs.ipynb", makeNotebook([
      { type: "markdown", source: "# Hello" },
    ]));

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs).toEqual([]);
  });

  test("throws when notebook file does not exist", async () => {
    await expect(readTool({
      notebook_path: path.join(tmpDir, "missing.ipynb"),
    })).rejects.toThrow();
  });

  test("throws when notebook contains invalid JSON", async () => {
    const badPath = path.join(tmpDir, "invalid.ipynb");
    fs.writeFileSync(badPath, "{ bad json }", "utf-8");

    await expect(readTool({ notebook_path: badPath })).rejects.toThrow();
  });

  test("stream output is returned as type stream", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "print('hi')",
        outputs: [{ output_type: "stream", name: "stdout", text: "hi\n" }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-stream.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].type).toBe("stream");
    expect(cells[0].outputs[0].name).toBe("stdout");
    expect(cells[0].outputs[0].text).toContain("hi");
  });

  test("error output is returned as type error", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "1/0",
        outputs: [{
          output_type: "error",
          ename: "ZeroDivisionError",
          evalue: "division by zero",
          traceback: [],
        }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-error.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].type).toBe("error");
    expect(cells[0].outputs[0].ename).toBe("ZeroDivisionError");
  });

  test("display_data with text/plain is returned as text", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "42",
        outputs: [{
          output_type: "execute_result",
          data: { "text/plain": "42" },
          metadata: {},
          execution_count: 1,
        }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-display.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toBe("42");
  });

  test("display_data with text/html falls back to stripped HTML", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "df",
        outputs: [{
          output_type: "display_data",
          data: { "text/html": "<table><tr><td>hello</td></tr></table>" },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-html.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toContain("hello");
    expect(cells[0].outputs[0].text).not.toContain("<table>");
  });

  test("display_data with array text/plain is joined", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "x",
        outputs: [{
          output_type: "execute_result",
          data: { "text/plain": ["line1\n", "line2"] },
          metadata: {},
          execution_count: 1,
        }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-array-plain.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toContain("line1");
    expect(cells[0].outputs[0].text).toContain("line2");
  });

  test("display_data with array text/html is joined and stripped", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "x",
        outputs: [{
          output_type: "display_data",
          data: { "text/html": ["<p>", "hello", "</p>"] },
          metadata: {},
        }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-array-html.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toContain("hello");
    expect(cells[0].outputs[0].text).not.toContain("<p>");
  });

  test("stream output with array text is joined", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "print('a'); print('b')",
        outputs: [{ output_type: "stream", name: "stdout", text: ["a\n", "b\n"] }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-stream-array.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toContain("a");
    expect(cells[0].outputs[0].text).toContain("b");
  });

  test("output with no data returns empty text", async () => {
    const nb = {
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{
        cell_type: "code",
        id: "c0",
        source: "x",
        outputs: [{ output_type: "display_data", data: {}, metadata: {} }],
        metadata: {},
      }],
    };
    const nbPath = writeNotebook("read-no-data.ipynb", nb);

    const { cells } = JSON.parse(await readTool({ notebook_path: nbPath }));
    expect(cells[0].outputs[0].text).toBe("");
  });
});
