import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { readTool } from "./read.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-read-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function writeFile(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function read(input: Record<string, unknown>): Promise<string> {
  return readTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("readTool metadata", () => {
  test("name is 'Read'", () => {
    expect(readTool.name).toBe("Read");
  });

  test("has a description", () => {
    expect(typeof readTool.description).toBe("string");
    expect(readTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof readTool.execute).toBe("function");
  });

  test("input_schema requires file_path", () => {
    expect(readTool.input_schema.required).toContain("file_path");
  });

  test("input_schema has offset property", () => {
    expect(readTool.input_schema.properties).toHaveProperty("offset");
  });

  test("input_schema has limit property", () => {
    expect(readTool.input_schema.properties).toHaveProperty("limit");
  });
});

// ── Basic file reading ─────────────────────────────────────────────────────────

describe("readTool — basic reading", () => {
  test("reads a simple file and returns its contents", async () => {
    const p = writeFile("simple.txt", "hello world\n");
    const result = await read({ file_path: p });
    expect(result).toContain("hello world");
  });

  test("returns file contents with line numbers", async () => {
    const p = writeFile("numbered.txt", "line one\nline two\nline three\n");
    const result = await read({ file_path: p });
    expect(result).toContain("1→");
    expect(result).toContain("2→");
    expect(result).toContain("3→");
  });

  test("reads a multiline file correctly", async () => {
    const content = "alpha\nbeta\ngamma\ndelta\n";
    const p = writeFile("multiline.txt", content);
    const result = await read({ file_path: p });
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
    expect(result).toContain("gamma");
    expect(result).toContain("delta");
  });

  test("reads an empty file and returns empty content with line number", async () => {
    const p = writeFile("empty.txt", "");
    const result = await read({ file_path: p });
    // Empty file: single empty line
    expect(typeof result).toBe("string");
  });

  test("reads a file with special characters", async () => {
    const content = "special: áéíóú çñ\nπ ∑ √\n";
    const p = writeFile("unicode.txt", content);
    const result = await read({ file_path: p });
    expect(result).toContain("áéíóú");
    expect(result).toContain("çñ");
  });

  test("reads a JSON file correctly", async () => {
    const content = '{"key": "value", "num": 42}';
    const p = writeFile("data.json", content);
    const result = await read({ file_path: p });
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
    expect(result).toContain("42");
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("readTool — error handling", () => {
  test("returns error message for non-existent file", async () => {
    const result = await read({ file_path: path.join(tmpDir, "does-not-exist.txt") });
    expect(result).toContain("Erro:");
  });

  test("error message contains relevant info", async () => {
    const fakePath = path.join(tmpDir, "ghost-file.txt");
    const result = await read({ file_path: fakePath });
    expect(typeof result).toBe("string");
    expect(result.toLowerCase()).toMatch(/erro|error|enoent/i);
  });

  test("handles directory path gracefully", async () => {
    const result = await read({ file_path: tmpDir });
    // Directories can't be read as files — should return error
    expect(typeof result).toBe("string");
  });
});

// ── Offset and limit ───────────────────────────────────────────────────────────

describe("readTool — offset and limit", () => {
  let fiveLinesPath: string;

  beforeAll(() => {
    fiveLinesPath = writeFile(
      "five-lines.txt",
      "line1\nline2\nline3\nline4\nline5\n"
    );
  });

  test("reads from the beginning with no offset", async () => {
    const result = await read({ file_path: fiveLinesPath });
    expect(result).toContain("line1");
    expect(result).toContain("line5");
  });

  test("offset skips lines (offset=3 skips first 2)", async () => {
    const result = await read({ file_path: fiveLinesPath, offset: 3 });
    expect(result).toContain("line3");
    expect(result).toContain("line4");
    expect(result).toContain("line5");
    expect(result).not.toContain("line1\n");
    expect(result).not.toContain("line2\n");
  });

  test("limit restricts how many lines are returned", async () => {
    const result = await read({ file_path: fiveLinesPath, limit: 2 });
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).not.toContain("line3");
    expect(result).not.toContain("line4");
    expect(result).not.toContain("line5");
  });

  test("offset and limit together work correctly", async () => {
    const result = await read({ file_path: fiveLinesPath, offset: 2, limit: 2 });
    expect(result).toContain("line2");
    expect(result).toContain("line3");
    expect(result).not.toContain("line1\n");
    expect(result).not.toContain("line4");
    expect(result).not.toContain("line5");
  });

  test("large offset beyond file returns empty/partial result", async () => {
    const result = await read({ file_path: fiveLinesPath, offset: 100 });
    // Should not throw, and might be empty
    expect(typeof result).toBe("string");
  });

  test("line numbers in output reflect offset", async () => {
    const result = await read({ file_path: fiveLinesPath, offset: 3 });
    // With offset=3, first line shown is line 3, so line number 3 appears
    expect(result).toContain("3→");
  });
});

// ── Truncation ─────────────────────────────────────────────────────────────────

describe("readTool — truncation", () => {
  test("large file content is truncated", async () => {
    // Create a file larger than 100_000 chars
    const bigContent = "x".repeat(100) + "\n";
    const repeated = bigContent.repeat(1100); // ~110_000 chars
    const p = writeFile("big.txt", repeated);
    const result = await read({ file_path: p });
    expect(result).toContain("[truncado]");
  });

  test("small file is not truncated", async () => {
    const p = writeFile("small.txt", "just a short file\n");
    const result = await read({ file_path: p });
    expect(result).not.toContain("[truncado]");
  });
});

// ── Line number format ─────────────────────────────────────────────────────────

describe("readTool — line number format", () => {
  test("line numbers use padded format with →", async () => {
    const p = writeFile("format.txt", "hello\nworld\n");
    const result = await read({ file_path: p });
    // Line numbers are right-padded with spaces and end with →
    expect(result).toMatch(/\d+→/);
  });

  test("first line is numbered 1", async () => {
    const p = writeFile("lineno.txt", "first line\nsecond line\n");
    const result = await read({ file_path: p });
    expect(result).toContain("1→first line");
  });

  test("second line is numbered 2", async () => {
    const p = writeFile("lineno2.txt", "first\nsecond\n");
    const result = await read({ file_path: p });
    expect(result).toContain("2→second");
  });
});

// ── Absolute vs relative paths ──────────────────────────────────────────────────

describe("readTool — path resolution", () => {
  test("reads absolute path correctly", async () => {
    const p = writeFile("absolute.txt", "absolute content\n");
    const result = await read({ file_path: p });
    expect(result).toContain("absolute content");
  });
});

// ── Path traversal protection ───────────────────────────────────────────────────

describe("readTool — path traversal protection", () => {
  test("returns error when path is outside allowed directories", async () => {
    // /etc/passwd is outside cwd, homedir, tmpdir, and /tmp on any Unix system
    const result = await read({ file_path: "/etc/passwd" });
    expect(result).toContain("Erro");
    expect(result.toLowerCase()).toMatch(/path traversal|denied|outside/i);
  });

  test("error message includes the denied path", async () => {
    const result = await read({ file_path: "/etc/shadow" });
    expect(result).toContain("/etc/shadow");
  });

  test("error message is a non-empty string", async () => {
    const result = await read({ file_path: "/etc/hosts" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
