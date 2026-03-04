import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { updateMemoryTool, appendMemoryTool } from "./memory.ts";
import { getProjectMemoryDir, ensureProjectMemoryPath } from "../lib/session.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-memory-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterAll(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  // Clean up memory file after each test
  try {
    const memDir = getProjectMemoryDir(process.cwd());
    const memPath = path.join(memDir, "MEMORY.md");
    if (fs.existsSync(memPath)) fs.rmSync(memPath);
  } catch {}
});

function getMemoryPath(): string {
  const memDir = getProjectMemoryDir(process.cwd());
  return path.join(memDir, "MEMORY.md");
}

async function updateMemory(input: Record<string, unknown>): Promise<string> {
  return updateMemoryTool.execute!(input) as Promise<string>;
}

async function appendMemory(input: Record<string, unknown>): Promise<string> {
  return appendMemoryTool.execute!(input) as Promise<string>;
}

// ── updateMemoryTool metadata ──────────────────────────────────────────────────

describe("updateMemoryTool metadata", () => {
  test("name is 'UpdateMemory'", () => {
    expect(updateMemoryTool.name).toBe("UpdateMemory");
  });

  test("has a description", () => {
    expect(typeof updateMemoryTool.description).toBe("string");
    expect(updateMemoryTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof updateMemoryTool.execute).toBe("function");
  });

  test("input_schema requires content", () => {
    expect(updateMemoryTool.input_schema.required).toContain("content");
  });
});

// ── updateMemoryTool — execute ─────────────────────────────────────────────────

describe("updateMemoryTool — execute", () => {
  test("creates MEMORY.md with given content", async () => {
    await updateMemory({ content: "# Memory\nSome content\n" });
    const memPath = getMemoryPath();
    expect(fs.existsSync(memPath)).toBe(true);
    expect(fs.readFileSync(memPath, "utf-8")).toBe("# Memory\nSome content\n");
  });

  test("returns success message with path", async () => {
    const result = await updateMemory({ content: "test\n" });
    expect(result).toContain("Memória atualizada");
    expect(result).toContain("MEMORY.md");
  });

  test("overwrites existing MEMORY.md", async () => {
    await updateMemory({ content: "original content\n" });
    await updateMemory({ content: "new content\n" });
    const memPath = getMemoryPath();
    expect(fs.readFileSync(memPath, "utf-8")).toBe("new content\n");
  });

  test("creates parent directories automatically", async () => {
    // Even if memory dir doesn't exist, it should be created
    const result = await updateMemory({ content: "# Test\n" });
    expect(result).toContain("MEMORY.md");
    const memPath = getMemoryPath();
    expect(fs.existsSync(memPath)).toBe(true);
  });

  test("writes empty content", async () => {
    await updateMemory({ content: "" });
    const memPath = getMemoryPath();
    expect(fs.readFileSync(memPath, "utf-8")).toBe("");
  });

  test("writes multiline content correctly", async () => {
    const content = "# Section 1\nInfo\n\n## Section 2\nMore info\n";
    await updateMemory({ content });
    const memPath = getMemoryPath();
    expect(fs.readFileSync(memPath, "utf-8")).toBe(content);
  });
});

// ── appendMemoryTool metadata ──────────────────────────────────────────────────

describe("appendMemoryTool metadata", () => {
  test("name is 'AppendMemory'", () => {
    expect(appendMemoryTool.name).toBe("AppendMemory");
  });

  test("has a description", () => {
    expect(typeof appendMemoryTool.description).toBe("string");
    expect(appendMemoryTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof appendMemoryTool.execute).toBe("function");
  });

  test("input_schema requires content", () => {
    expect(appendMemoryTool.input_schema.required).toContain("content");
  });
});

// ── appendMemoryTool — execute ─────────────────────────────────────────────────

describe("appendMemoryTool — execute", () => {
  test("creates MEMORY.md when it does not exist", async () => {
    await appendMemory({ content: "first content\n" });
    const memPath = getMemoryPath();
    expect(fs.existsSync(memPath)).toBe(true);
    expect(fs.readFileSync(memPath, "utf-8")).toBe("first content\n");
  });

  test("returns success message with path", async () => {
    const result = await appendMemory({ content: "some text\n" });
    expect(result).toContain("Memória adicionada");
    expect(result).toContain("MEMORY.md");
  });

  test("appends to existing content with newline separator", async () => {
    await updateMemory({ content: "original\n" });
    await appendMemory({ content: "appended\n" });
    const memPath = getMemoryPath();
    const content = fs.readFileSync(memPath, "utf-8");
    expect(content).toContain("original");
    expect(content).toContain("appended");
  });

  test("appends multiple times, accumulating content", async () => {
    await updateMemory({ content: "base\n" });
    await appendMemory({ content: "part1\n" });
    await appendMemory({ content: "part2\n" });
    await appendMemory({ content: "part3\n" });
    const memPath = getMemoryPath();
    const content = fs.readFileSync(memPath, "utf-8");
    expect(content).toContain("base");
    expect(content).toContain("part1");
    expect(content).toContain("part2");
    expect(content).toContain("part3");
  });

  test("separator logic: adds double newline when existing content doesn't end with newline", async () => {
    await updateMemory({ content: "no trailing newline" }); // no \n at end
    await appendMemory({ content: "appended" });
    const memPath = getMemoryPath();
    const content = fs.readFileSync(memPath, "utf-8");
    // Should have separator between them
    expect(content).toContain("no trailing newline");
    expect(content).toContain("appended");
    // The separator should be \n\n
    expect(content).toContain("\n\n");
  });

  test("separator logic: adds single newline when existing content ends with newline", async () => {
    await updateMemory({ content: "with trailing newline\n" });
    await appendMemory({ content: "appended" });
    const memPath = getMemoryPath();
    const content = fs.readFileSync(memPath, "utf-8");
    // When existing ends with \n, separator is "\n", giving "\n\n" total between content and appended
    expect(content).toBe("with trailing newline\n\nappended");
  });

  test("no separator when file was empty", async () => {
    // File doesn't exist yet
    await appendMemory({ content: "first" });
    const memPath = getMemoryPath();
    expect(fs.readFileSync(memPath, "utf-8")).toBe("first");
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("updateMemoryTool — write error handling", () => {
  test("returns error message when MEMORY.md path is a directory", async () => {
    const memDir = getProjectMemoryDir(process.cwd());
    fs.mkdirSync(memDir, { recursive: true });
    const memPath = path.join(memDir, "MEMORY.md");

    // Create a DIRECTORY at the MEMORY.md location so writeFileSync fails with EISDIR
    fs.mkdirSync(memPath, { recursive: true });

    try {
      const result = await updateMemory({ content: "test content" });
      expect(result).toContain("Erro ao atualizar memória:");
    } finally {
      fs.rmSync(memPath, { recursive: true, force: true });
    }
  });
});

describe("appendMemoryTool — write error handling", () => {
  test("returns error message when MEMORY.md path is a directory", async () => {
    const memDir = getProjectMemoryDir(process.cwd());
    fs.mkdirSync(memDir, { recursive: true });
    const memPath = path.join(memDir, "MEMORY.md");

    // Create a DIRECTORY at the MEMORY.md location so writeFileSync fails with EISDIR
    fs.mkdirSync(memPath, { recursive: true });

    try {
      const result = await appendMemory({ content: "test content" });
      expect(result).toContain("Erro ao adicionar à memória:");
    } finally {
      fs.rmSync(memPath, { recursive: true, force: true });
    }
  });
});
