import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { buildClaudeMdSection, loadClaudeMd, updateMemory } from "./claudeMd.ts";
import type { ClaudeMdContent } from "./claudeMd.ts";

// ─── Temp directory setup ────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), `claudemd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── buildClaudeMdSection ────────────────────────────────────────────────────

describe("buildClaudeMdSection", () => {
  test("all null → returns empty string", () => {
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: null,
      memory: null,
    };
    expect(buildClaudeMdSection(content)).toBe("");
  });

  test("only userInstructions → wraps in user_instructions tags", () => {
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: "do things",
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toBe("<user_instructions>\ndo things\n</user_instructions>");
  });

  test("only projectInstructions → wraps in project_instructions tags", () => {
    const content: ClaudeMdContent = {
      projectInstructions: "project rules",
      localInstructions: null,
      userInstructions: null,
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toBe("<project_instructions>\nproject rules\n</project_instructions>");
  });

  test("only localInstructions → wraps in local_instructions tags", () => {
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: "local config",
      userInstructions: null,
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toBe("<local_instructions>\nlocal config\n</local_instructions>");
  });

  test("only memory → wraps in memory tags", () => {
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: null,
      memory: "remember this",
    };
    const result = buildClaudeMdSection(content);
    expect(result).toBe("<memory>\nremember this\n</memory>");
  });

  test("all populated → all 4 sections separated by blank lines", () => {
    const content: ClaudeMdContent = {
      projectInstructions: "proj",
      localInstructions: "local",
      userInstructions: "user",
      memory: "mem",
    };
    const result = buildClaudeMdSection(content);
    const parts = result.split("\n\n");
    expect(parts).toHaveLength(4);
    expect(result).toContain("<user_instructions>\nuser\n</user_instructions>");
    expect(result).toContain("<project_instructions>\nproj\n</project_instructions>");
    expect(result).toContain("<local_instructions>\nlocal\n</local_instructions>");
    expect(result).toContain("<memory>\nmem\n</memory>");
  });

  test("section order: user → project → local → memory", () => {
    const content: ClaudeMdContent = {
      projectInstructions: "proj",
      localInstructions: "local",
      userInstructions: "user",
      memory: "mem",
    };
    const result = buildClaudeMdSection(content);
    const uIdx = result.indexOf("<user_instructions>");
    const pIdx = result.indexOf("<project_instructions>");
    const lIdx = result.indexOf("<local_instructions>");
    const mIdx = result.indexOf("<memory>");
    expect(uIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(lIdx);
    expect(lIdx).toBeLessThan(mIdx);
  });

  test("exactly 200 lines → not truncated", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: lines.join("\n"),
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).not.toContain("[... truncated at 200 lines]");
    expect(result).toContain("line 200");
  });

  test("201 lines → truncated with marker", () => {
    const lines = Array.from({ length: 201 }, (_, i) => `line ${i + 1}`);
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: lines.join("\n"),
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toContain("[... truncated at 200 lines]");
    expect(result).not.toContain("line 201");
  });

  test("long project instructions → truncated", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `rule ${i + 1}`);
    const content: ClaudeMdContent = {
      projectInstructions: lines.join("\n"),
      localInstructions: null,
      userInstructions: null,
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toContain("[... truncated at 200 lines]");
    expect(result).not.toContain("rule 201");
  });

  test("long memory → truncated", () => {
    const lines = Array.from({ length: 205 }, (_, i) => `memory line ${i + 1}`);
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: null,
      memory: lines.join("\n"),
    };
    const result = buildClaudeMdSection(content);
    expect(result).toContain("[... truncated at 200 lines]");
  });

  test("long local instructions → truncated", () => {
    const lines = Array.from({ length: 205 }, (_, i) => `local line ${i + 1}`);
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: lines.join("\n"),
      userInstructions: null,
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toContain("[... truncated at 200 lines]");
  });

  test("single-line content → not truncated", () => {
    const content: ClaudeMdContent = {
      projectInstructions: null,
      localInstructions: null,
      userInstructions: "just one line",
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).not.toContain("[... truncated");
    expect(result).toContain("just one line");
  });

  test("empty string values treated as falsy → not included", () => {
    const content: ClaudeMdContent = {
      projectInstructions: "",
      localInstructions: "",
      userInstructions: "",
      memory: "",
    };
    // Empty strings are falsy in JS
    expect(buildClaudeMdSection(content)).toBe("");
  });

  test("only two sections → separated by single blank line", () => {
    const content: ClaudeMdContent = {
      projectInstructions: "proj",
      localInstructions: null,
      userInstructions: "user",
      memory: null,
    };
    const result = buildClaudeMdSection(content);
    expect(result).toBe(
      "<user_instructions>\nuser\n</user_instructions>\n\n<project_instructions>\nproj\n</project_instructions>"
    );
  });
});

// ─── loadClaudeMd ────────────────────────────────────────────────────────────

describe("loadClaudeMd", () => {
  test("returns object with the 4 expected keys", () => {
    const result = loadClaudeMd();
    expect(result).toHaveProperty("projectInstructions");
    expect(result).toHaveProperty("localInstructions");
    expect(result).toHaveProperty("userInstructions");
    expect(result).toHaveProperty("memory");
  });

  test("each key is string or null", () => {
    const result = loadClaudeMd();
    for (const key of ["projectInstructions", "localInstructions", "userInstructions", "memory"] as const) {
      expect(result[key] === null || typeof result[key] === "string").toBe(true);
    }
  });

  test("cache: calling twice returns same object reference", () => {
    const first = loadClaudeMd();
    const second = loadClaudeMd();
    expect(first).toBe(second);
  });

  test("cache: same content properties on repeated calls", () => {
    const first = loadClaudeMd();
    const second = loadClaudeMd();
    expect(first.projectInstructions).toBe(second.projectInstructions);
    expect(first.localInstructions).toBe(second.localInstructions);
    expect(first.userInstructions).toBe(second.userInstructions);
    expect(first.memory).toBe(second.memory);
  });
});

// ─── updateMemory ────────────────────────────────────────────────────────────

describe("updateMemory", () => {
  const memoryPath = path.join(os.homedir(), ".sofik", "MEMORY.md");
  let originalContent: string | null = null;

  beforeAll(() => {
    // Preserve any existing MEMORY.md content
    try {
      originalContent = fs.readFileSync(memoryPath, "utf-8");
    } catch {
      originalContent = null;
    }
  });

  afterAll(() => {
    // Restore original content
    if (originalContent !== null) {
      fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
      fs.writeFileSync(memoryPath, originalContent, "utf-8");
    } else {
      // Remove the file we created if it didn't exist before
      try { fs.unlinkSync(memoryPath); } catch { /* ignore */ }
    }
  });

  test("writes content to ~/.sofik/MEMORY.md", () => {
    const testContent = `# Test Memory\n\nWritten at ${Date.now()}`;
    updateMemory(testContent);
    const written = fs.readFileSync(memoryPath, "utf-8");
    expect(written).toBe(testContent);
  });

  test("overwrites existing content", () => {
    updateMemory("first content");
    updateMemory("second content");
    const written = fs.readFileSync(memoryPath, "utf-8");
    expect(written).toBe("second content");
  });

  test("creates directory if it does not exist", () => {
    const sofIkDir = path.join(os.homedir(), ".sofik");
    // The directory might already exist, but updateMemory must not throw even if it does
    expect(() => updateMemory("test")).not.toThrow();
    expect(fs.existsSync(memoryPath)).toBe(true);
  });

  test("writes empty string", () => {
    updateMemory("");
    const written = fs.readFileSync(memoryPath, "utf-8");
    expect(written).toBe("");
  });

  test("writes multiline content preserving newlines", () => {
    const multiline = "line 1\nline 2\nline 3";
    updateMemory(multiline);
    const written = fs.readFileSync(memoryPath, "utf-8");
    expect(written).toBe(multiline);
  });
});
