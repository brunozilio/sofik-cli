import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { multiEditTool } from "./multiEdit.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let counter = 0;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-multiedit-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(content: string): string {
  const p = path.join(tmpDir, `file-${counter++}.txt`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function multiEdit(input: Record<string, unknown>): Promise<string> {
  return multiEditTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("multiEditTool metadata", () => {
  test("name is 'MultiEdit'", () => {
    expect(multiEditTool.name).toBe("MultiEdit");
  });

  test("has a description", () => {
    expect(typeof multiEditTool.description).toBe("string");
    expect(multiEditTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof multiEditTool.execute).toBe("function");
  });

  test("input_schema requires edits", () => {
    expect(multiEditTool.input_schema.required).toContain("edits");
  });
});

// ── Single file edits ──────────────────────────────────────────────────────────

describe("multiEditTool — single file", () => {
  test("applies single edit to a file", async () => {
    const p = tmpFile("hello world\n");
    await multiEdit({
      edits: [{ file_path: p, old_string: "hello", new_string: "goodbye" }],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe("goodbye world\n");
  });

  test("applies multiple edits to same file atomically", async () => {
    const p = tmpFile("alpha beta gamma\n");
    await multiEdit({
      edits: [
        { file_path: p, old_string: "alpha", new_string: "A" },
        { file_path: p, old_string: "beta", new_string: "B" },
        { file_path: p, old_string: "gamma", new_string: "G" },
      ],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe("A B G\n");
  });

  test("returns success message with checkmark", async () => {
    const p = tmpFile("test content\n");
    const result = await multiEdit({
      edits: [{ file_path: p, old_string: "test", new_string: "edited" }],
    });
    expect(result).toContain("✓");
  });

  test("success message includes file path", async () => {
    const p = tmpFile("content here\n");
    const result = await multiEdit({
      edits: [{ file_path: p, old_string: "content", new_string: "changed" }],
    });
    expect(result).toContain(p);
  });

  test("success message includes edit count", async () => {
    const p = tmpFile("a b c\n");
    const result = await multiEdit({
      edits: [
        { file_path: p, old_string: "a", new_string: "x" },
        { file_path: p, old_string: "b", new_string: "y" },
      ],
    });
    expect(result).toContain("2");
  });
});

// ── Multiple files ─────────────────────────────────────────────────────────────

describe("multiEditTool — multiple files", () => {
  test("edits multiple files in one call", async () => {
    const p1 = tmpFile("file1 content\n");
    const p2 = tmpFile("file2 content\n");
    await multiEdit({
      edits: [
        { file_path: p1, old_string: "file1", new_string: "edited1" },
        { file_path: p2, old_string: "file2", new_string: "edited2" },
      ],
    });
    expect(fs.readFileSync(p1, "utf-8")).toBe("edited1 content\n");
    expect(fs.readFileSync(p2, "utf-8")).toBe("edited2 content\n");
  });

  test("result contains entries for each file", async () => {
    const p1 = tmpFile("foo bar\n");
    const p2 = tmpFile("baz qux\n");
    const result = await multiEdit({
      edits: [
        { file_path: p1, old_string: "foo", new_string: "F" },
        { file_path: p2, old_string: "baz", new_string: "B" },
      ],
    });
    expect(result).toContain(p1);
    expect(result).toContain(p2);
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("multiEditTool — errors", () => {
  test("returns error for empty edits array", async () => {
    const result = await multiEdit({ edits: [] });
    expect(result).toContain("Erro");
  });

  test("returns error when old_string not found", async () => {
    const p = tmpFile("hello world\n");
    const result = await multiEdit({
      edits: [{ file_path: p, old_string: "nonexistent", new_string: "x" }],
    });
    expect(result).toContain("Erro");
    expect(result).toContain("old_string não encontrado");
  });

  test("file is unchanged when old_string not found", async () => {
    const original = "unchanged\n";
    const p = tmpFile(original);
    await multiEdit({
      edits: [{ file_path: p, old_string: "missing", new_string: "replacement" }],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe(original);
  });

  test("returns error when old_string appears multiple times without replace_all", async () => {
    const p = tmpFile("dup dup dup\n");
    const result = await multiEdit({
      edits: [{ file_path: p, old_string: "dup", new_string: "x" }],
    });
    expect(result).toContain("Erro");
    expect(result).toContain("replace_all");
  });

  test("returns error when file does not exist", async () => {
    const result = await multiEdit({
      edits: [
        { file_path: path.join(tmpDir, "nonexistent.txt"), old_string: "x", new_string: "y" },
      ],
    });
    expect(result).toContain("Erro");
  });

  test("non-array edits returns error", async () => {
    const result = await multiEdit({ edits: null });
    expect(result).toContain("Erro");
  });
});

// ── replace_all ────────────────────────────────────────────────────────────────

describe("multiEditTool — replace_all", () => {
  test("replace_all replaces all occurrences in a file", async () => {
    const p = tmpFile("cat cat cat\n");
    await multiEdit({
      edits: [{ file_path: p, old_string: "cat", new_string: "dog", replace_all: true }],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe("dog dog dog\n");
  });

  test("replace_all succeeds with single occurrence", async () => {
    const p = tmpFile("only once here\n");
    await multiEdit({
      edits: [{ file_path: p, old_string: "only once", new_string: "just one", replace_all: true }],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe("just one here\n");
  });

  test("replace_all with multiple occurrences succeeds", async () => {
    const p = tmpFile("a a a a\n");
    const result = await multiEdit({
      edits: [{ file_path: p, old_string: "a", new_string: "z", replace_all: true }],
    });
    expect(result).not.toContain("Erro");
    expect(fs.readFileSync(p, "utf-8")).toBe("z z z z\n");
  });
});

// ── Atomic file write ──────────────────────────────────────────────────────────

describe("multiEditTool — atomicity", () => {
  test("file is written once per file even with multiple edits", async () => {
    // Multiple edits to the same file should result in one write
    const p = tmpFile("a b c d e\n");
    await multiEdit({
      edits: [
        { file_path: p, old_string: "a", new_string: "1" },
        { file_path: p, old_string: "b", new_string: "2" },
        { file_path: p, old_string: "c", new_string: "3" },
        { file_path: p, old_string: "d", new_string: "4" },
        { file_path: p, old_string: "e", new_string: "5" },
      ],
    });
    expect(fs.readFileSync(p, "utf-8")).toBe("1 2 3 4 5\n");
  });

  test("stops processing edits for a file if an edit fails", async () => {
    // If first edit fails, subsequent edits for that file shouldn't run
    const p = tmpFile("valid content here\n");
    const original = fs.readFileSync(p, "utf-8");
    await multiEdit({
      edits: [
        { file_path: p, old_string: "missing_string", new_string: "x" }, // fails
        { file_path: p, old_string: "valid", new_string: "invalid" }, // should not run
      ],
    });
    // File should be unchanged because first edit failed
    expect(fs.readFileSync(p, "utf-8")).toBe(original);
  });
});
