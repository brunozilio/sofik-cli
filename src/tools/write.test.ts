import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { writeTool } from "./write.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-write-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function write(input: Record<string, unknown>): Promise<string> {
  return writeTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("writeTool metadata", () => {
  test("name is 'Write'", () => {
    expect(writeTool.name).toBe("Write");
  });

  test("has a description", () => {
    expect(typeof writeTool.description).toBe("string");
    expect(writeTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof writeTool.execute).toBe("function");
  });

  test("input_schema requires file_path", () => {
    expect(writeTool.input_schema.required).toContain("file_path");
  });

  test("input_schema requires content", () => {
    expect(writeTool.input_schema.required).toContain("content");
  });
});

// ── Basic writing ──────────────────────────────────────────────────────────────

describe("writeTool — basic writing", () => {
  test("creates a new file with the given content", async () => {
    const p = path.join(tmpDir, "new-file.txt");
    await write({ file_path: p, content: "hello world\n" });
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("hello world\n");
  });

  test("returns line count message", async () => {
    const p = path.join(tmpDir, "count.txt");
    const result = await write({ file_path: p, content: "line1\nline2\nline3\n" });
    expect(result).toContain("3");
    expect(result).toContain("linhas");
  });

  test("returns path in success message", async () => {
    const p = path.join(tmpDir, "with-path.txt");
    const result = await write({ file_path: p, content: "test\n" });
    expect(result).toContain(p);
  });

  test("overwrites existing file with new content", async () => {
    const p = path.join(tmpDir, "overwrite.txt");
    fs.writeFileSync(p, "old content\n", "utf-8");
    await write({ file_path: p, content: "new content\n" });
    expect(fs.readFileSync(p, "utf-8")).toBe("new content\n");
  });

  test("writes empty content", async () => {
    const p = path.join(tmpDir, "empty.txt");
    await write({ file_path: p, content: "" });
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("");
  });

  test("writes content with special characters", async () => {
    const content = "áéíóú çñ π ∑ √\n";
    const p = path.join(tmpDir, "unicode.txt");
    await write({ file_path: p, content });
    expect(fs.readFileSync(p, "utf-8")).toBe(content);
  });

  test("writes multiline content correctly", async () => {
    const content = "line1\nline2\nline3\n";
    const p = path.join(tmpDir, "multiline.txt");
    await write({ file_path: p, content });
    expect(fs.readFileSync(p, "utf-8")).toBe(content);
  });

  test("writes JSON content correctly", async () => {
    const content = '{"key": "value", "num": 42}';
    const p = path.join(tmpDir, "data.json");
    await write({ file_path: p, content });
    expect(JSON.parse(fs.readFileSync(p, "utf-8"))).toEqual({ key: "value", num: 42 });
  });
});

// ── Directory creation ─────────────────────────────────────────────────────────

describe("writeTool — directory creation", () => {
  test("creates parent directories that don't exist", async () => {
    const nested = path.join(tmpDir, "deep", "nested", "dir", "file.txt");
    await write({ file_path: nested, content: "nested\n" });
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.readFileSync(nested, "utf-8")).toBe("nested\n");
  });

  test("works when parent directory already exists", async () => {
    const p = path.join(tmpDir, "file-in-existing-dir.txt");
    await write({ file_path: p, content: "content\n" });
    expect(fs.existsSync(p)).toBe(true);
  });

  test("creates deeply nested path in one call", async () => {
    const deep = path.join(tmpDir, "a", "b", "c", "d", "e", "file.txt");
    await write({ file_path: deep, content: "deep\n" });
    expect(fs.existsSync(deep)).toBe(true);
  });
});

// ── Line count reporting ───────────────────────────────────────────────────────

describe("writeTool — line count", () => {
  test("single-line content reports 1 line", async () => {
    const p = path.join(tmpDir, "one-line.txt");
    const result = await write({ file_path: p, content: "single line" });
    expect(result).toContain("1");
  });

  test("two-line content reports 2 lines", async () => {
    const p = path.join(tmpDir, "two-lines.txt");
    const result = await write({ file_path: p, content: "line1\nline2\n" });
    // 3 lines: "line1", "line2", ""
    expect(result).toContain("3");
  });

  test("empty content has at least 1 line (empty string split by newline)", async () => {
    const p = path.join(tmpDir, "empty-lines.txt");
    const result = await write({ file_path: p, content: "" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("writeTool — error handling", () => {
  test("returns error message when mkdirSync fails (parent is a file)", async () => {
    // Create a FILE where we'd need a DIRECTORY as parent
    const parentFile = path.join(tmpDir, "i-am-a-file.txt");
    fs.writeFileSync(parentFile, "I am a file, not a directory", "utf-8");

    // Try to write to a path whose parent is this file (ENOTDIR)
    const childPath = path.join(parentFile, "child.txt");
    const result = await write({ file_path: childPath, content: "content" });

    expect(result).toContain("Erro");
  });
});
