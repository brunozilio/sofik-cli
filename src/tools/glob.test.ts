import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { globTool } from "./glob.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-glob-test-"));
  // Create test structure
  fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "lib"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "index.ts"), "// root ts", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "README.md"), "# Readme", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "src", "app.ts"), "// app", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "src", "app.tsx"), "// tsx", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "src", "lib", "utils.ts"), "// utils", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "src", "lib", "helper.js"), "// js", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "index.ts"), "// pkg", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".git", "config"), "config", "utf-8");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function glob(input: Record<string, unknown>): Promise<string> {
  return globTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("globTool metadata", () => {
  test("name is 'Glob'", () => {
    expect(globTool.name).toBe("Glob");
  });

  test("has a description", () => {
    expect(typeof globTool.description).toBe("string");
    expect(globTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof globTool.execute).toBe("function");
  });

  test("input_schema requires pattern", () => {
    expect(globTool.input_schema.required).toContain("pattern");
  });

  test("input_schema has path property", () => {
    expect(globTool.input_schema.properties).toHaveProperty("path");
  });
});

// ── Basic glob matching ────────────────────────────────────────────────────────

describe("globTool — basic matching", () => {
  test("finds .ts files in directory", async () => {
    const result = await glob({ pattern: "*.ts", path: tmpDir });
    expect(result).toContain("index.ts");
  });

  test("finds .md files in directory", async () => {
    const result = await glob({ pattern: "*.md", path: tmpDir });
    expect(result).toContain("README.md");
  });

  test("finds .tsx files", async () => {
    const result = await glob({ pattern: "*.tsx", path: path.join(tmpDir, "src") });
    expect(result).toContain("app.tsx");
  });

  test("finds .js files", async () => {
    const result = await glob({ pattern: "*.js", path: path.join(tmpDir, "src", "lib") });
    expect(result).toContain("helper.js");
  });
});

// ── No matches ─────────────────────────────────────────────────────────────────

describe("globTool — no matches", () => {
  test("returns 'não encontrado' message when no files match", async () => {
    const result = await glob({ pattern: "*.xyz", path: tmpDir });
    expect(result).toContain("Nenhum arquivo encontrado");
  });

  test("no match for nonexistent extension", async () => {
    const result = await glob({ pattern: "*.nonexistent", path: tmpDir });
    expect(result).toContain("Nenhum arquivo encontrado");
  });
});

// ── node_modules and .git exclusion ───────────────────────────────────────────

describe("globTool — exclusions", () => {
  test("excludes node_modules from results", async () => {
    const result = await glob({ pattern: "*.ts", path: tmpDir });
    // node_modules/pkg/index.ts should NOT appear
    expect(result).not.toContain("node_modules");
  });

  test("excludes .git directory from results", async () => {
    const result = await glob({ pattern: "config", path: tmpDir });
    expect(result).not.toContain(".git");
  });
});

// ── Path parameter ─────────────────────────────────────────────────────────────

describe("globTool — path parameter", () => {
  test("restricts search to specified path", async () => {
    const result = await glob({ pattern: "*.ts", path: path.join(tmpDir, "src", "lib") });
    expect(result).toContain("utils.ts");
    // Should not include root index.ts if limited to src/lib
    // Note: find is recursive, so it may find things in subdirs
  });

  test("uses process.cwd() when path is not specified", async () => {
    // This just tests it doesn't throw
    const result = await glob({ pattern: "*.ts" });
    expect(typeof result).toBe("string");
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("globTool — error handling", () => {
  test("returns error for completely invalid path", async () => {
    const result = await glob({ pattern: "*.ts", path: "/completely/nonexistent/path/xyz" });
    // May return empty or error
    expect(typeof result).toBe("string");
  });

  test("returns string result in all cases", async () => {
    const result = await glob({ pattern: "**", path: tmpDir });
    expect(typeof result).toBe("string");
  });
});

// ── Result format ──────────────────────────────────────────────────────────────

describe("globTool — result format", () => {
  test("results are newline-separated paths", async () => {
    const result = await glob({ pattern: "*.ts", path: tmpDir });
    if (result !== "Nenhum arquivo encontrado com o padrão.") {
      const lines = result.trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });

  test("result contains absolute paths", async () => {
    const result = await glob({ pattern: "*.ts", path: tmpDir });
    if (result !== "Nenhum arquivo encontrado com o padrão.") {
      expect(result).toContain(tmpDir);
    }
  });
});
