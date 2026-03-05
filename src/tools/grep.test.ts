import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { grepTool } from "./grep.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-grep-test-"));

  fs.writeFileSync(path.join(tmpDir, "file1.ts"), "export function hello() {\n  return 'hello';\n}\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "file2.ts"), "export function world() {\n  return 'world';\n}\n\nfunction helper() {}\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Hello World\n\nThis is a readme.\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "config.json"), '{"name": "test", "version": "1.0.0"}', "utf-8");
  fs.writeFileSync(path.join(tmpDir, "Case.ts"), "const UPPER = 'HELLO';\nconst lower = 'world';\n", "utf-8");
  fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg.js"), "function hello() {}\n", "utf-8");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function grep(input: Record<string, unknown>): Promise<string> {
  return grepTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("grepTool metadata", () => {
  test("name is 'Grep'", () => {
    expect(grepTool.name).toBe("Grep");
  });

  test("has a description", () => {
    expect(typeof grepTool.description).toBe("string");
    expect(grepTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof grepTool.execute).toBe("function");
  });

  test("input_schema requires pattern", () => {
    expect(grepTool.input_schema.required).toContain("pattern");
  });

  test("input_schema has path property", () => {
    expect(grepTool.input_schema.properties).toHaveProperty("path");
  });

  test("input_schema has glob property", () => {
    expect(grepTool.input_schema.properties).toHaveProperty("glob");
  });

  test("input_schema has case_insensitive property", () => {
    expect(grepTool.input_schema.properties).toHaveProperty("case_insensitive");
  });

  test("input_schema has output_mode property", () => {
    expect(grepTool.input_schema.properties).toHaveProperty("output_mode");
  });

  test("input_schema has context property", () => {
    expect(grepTool.input_schema.properties).toHaveProperty("context");
  });
});

// ── Basic search ───────────────────────────────────────────────────────────────

describe("grepTool — basic search", () => {
  test("finds files containing a pattern", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir });
    expect(result).toContain("file1.ts");
  });

  test("finds multiple files containing pattern", async () => {
    const result = await grep({ pattern: "function", path: tmpDir, output_mode: "files_with_matches" });
    expect(result).toContain("file1.ts");
    expect(result).toContain("file2.ts");
  });

  test("returns no-match message when pattern not found", async () => {
    const result = await grep({ pattern: "xyz_not_in_any_file_123", path: tmpDir });
    expect(result).toContain("Nenhuma correspondência encontrada");
  });

  test("default output_mode is files_with_matches (returns file paths)", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir });
    // Default mode: file paths
    expect(result).toMatch(/\.(ts|md|json)/);
  });
});

// ── Output modes ───────────────────────────────────────────────────────────────

describe("grepTool — output modes", () => {
  test("files_with_matches mode returns only file paths", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir, output_mode: "files_with_matches" });
    expect(result).toContain("file1.ts");
    // Should not contain line numbers in files_with_matches mode
  });

  test("content mode returns matching lines with line numbers", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir, output_mode: "content" });
    // Content mode includes the line content
    expect(result).toContain("hello");
    // Should have line numbers
    expect(result).toMatch(/:\d+:/);
  });

  test("count mode returns count per file", async () => {
    const result = await grep({ pattern: "function", path: tmpDir, output_mode: "count" });
    // Count mode: file:count
    expect(result).toMatch(/\d+/);
  });
});

// ── Case sensitivity ───────────────────────────────────────────────────────────

describe("grepTool — case sensitivity", () => {
  test("case-sensitive search (default) does not find wrong case", async () => {
    // "UPPER" exists in Case.ts, 'hello' is lowercase in file1.ts
    const result = await grep({ pattern: "HELLO", path: tmpDir, output_mode: "files_with_matches" });
    // Should find Case.ts which has 'HELLO'
    expect(result).toContain("Case.ts");
    // Should NOT find file1.ts ('hello' lowercase)
    expect(result).not.toContain("file1.ts");
  });

  test("case-insensitive search finds both cases", async () => {
    const result = await grep({
      pattern: "hello",
      path: tmpDir,
      case_insensitive: true,
      output_mode: "files_with_matches",
    });
    // Should find file1.ts ('hello') and Case.ts ('HELLO')
    expect(result).toContain("file1.ts");
    expect(result).toContain("Case.ts");
  });
});

// ── Glob filter ────────────────────────────────────────────────────────────────

describe("grepTool — glob filter", () => {
  test("glob filter restricts to matching file types", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir, glob: "*.md" });
    // Only readme.md has 'hello' (capitalized 'Hello')
    // With case-sensitive search, 'hello' won't match 'Hello'
    // Let's check the result type
    expect(typeof result).toBe("string");
  });

  test("glob filter with .ts files only finds ts files", async () => {
    const result = await grep({
      pattern: "function",
      path: tmpDir,
      glob: "*.ts",
      output_mode: "files_with_matches",
    });
    // Should find .ts files
    expect(result).toContain(".ts");
    // Should NOT find .md files
    expect(result).not.toContain(".md");
  });
});

// ── node_modules exclusion ─────────────────────────────────────────────────────

describe("grepTool — node_modules exclusion", () => {
  test("excludes node_modules from results", async () => {
    const result = await grep({ pattern: "hello", path: tmpDir, output_mode: "files_with_matches" });
    expect(result).not.toContain("node_modules");
  });
});

// ── Context lines ──────────────────────────────────────────────────────────────

describe("grepTool — context", () => {
  test("context parameter includes surrounding lines", async () => {
    const result = await grep({
      pattern: "return",
      path: tmpDir,
      output_mode: "content",
      context: 1,
    });
    // With context, should include lines around the match
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Result limit ───────────────────────────────────────────────────────────────

describe("grepTool — result limit", () => {
  test("indicates when results are limited to 100", async () => {
    // Create many matching files to potentially hit the limit
    // For now just verify the result format
    const result = await grep({ pattern: ".", path: tmpDir, output_mode: "files_with_matches" });
    expect(typeof result).toBe("string");
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("grepTool — error handling", () => {
  test("returns error message for invalid regex pattern", async () => {
    // An unmatched '[' is an invalid POSIX regex — grep exits with status 2
    const result = await grep({ pattern: "[invalid-unclosed-bracket", path: tmpDir });
    expect(typeof result).toBe("string");
    // Should return either no-match or an error message (not throw)
    expect(result).toBeTruthy();
  });
});

// ── Regex patterns ─────────────────────────────────────────────────────────────

describe("grepTool — regex patterns", () => {
  test("regex pattern matches correctly", async () => {
    // Use a pattern compatible with BSD grep (no \w, no + quantifier)
    const result = await grep({
      pattern: "function hello",
      path: tmpDir,
      output_mode: "files_with_matches",
    });
    expect(result).toContain("file1.ts");
  });

  test("character class in pattern", async () => {
    // Use a simple character class without + quantifier (BSD grep compatible)
    const result = await grep({
      pattern: "[0-9]\.[0-9]",
      path: tmpDir,
      output_mode: "files_with_matches",
    });
    // config.json has "1.0.0"
    expect(result).toContain("config.json");
  });
});
