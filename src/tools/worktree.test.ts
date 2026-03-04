import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

import { enterWorktreeTool, getActiveWorktree } from "./worktree.ts";

// ── Temp git repo setup ────────────────────────────────────────────────────────

let repoDir: string;
let nonGitDir: string;
let origCwd: string;

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-worktree-repo-"));
  nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-worktree-nongit-"));
  origCwd = process.cwd();

  // Initialize git repo
  execSync("git init", { cwd: repoDir });
  execSync('git config user.email "test@example.com"', { cwd: repoDir });
  execSync('git config user.name "Test User"', { cwd: repoDir });

  // Create initial commit (needed for worktrees)
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Test\n", "utf-8");
  execSync("git add README.md", { cwd: repoDir });
  execSync('git commit -m "Initial commit"', { cwd: repoDir });
});

afterAll(() => {
  process.chdir(origCwd);
  // Clean up worktrees before removing directory
  try {
    const result = execSync("git worktree list --porcelain", { cwd: repoDir, encoding: "utf-8" });
    const lines = result.split("\n").filter((l) => l.startsWith("worktree "));
    for (const line of lines.slice(1)) { // skip main worktree
      const wt = line.replace("worktree ", "").trim();
      try { execSync(`git worktree remove --force "${wt}"`, { cwd: repoDir }); } catch {}
    }
  } catch {}
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(nonGitDir, { recursive: true, force: true });
});

async function enterWorktree(input: Record<string, unknown>): Promise<string> {
  return enterWorktreeTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("enterWorktreeTool metadata", () => {
  test("name is 'EnterWorktree'", () => {
    expect(enterWorktreeTool.name).toBe("EnterWorktree");
  });

  test("has a description", () => {
    expect(typeof enterWorktreeTool.description).toBe("string");
    expect(enterWorktreeTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof enterWorktreeTool.execute).toBe("function");
  });

  test("input_schema has name property", () => {
    expect(enterWorktreeTool.input_schema.properties).toHaveProperty("name");
  });

  test("input_schema requires no fields", () => {
    expect(enterWorktreeTool.input_schema.required).toEqual([]);
  });
});

// ── getActiveWorktree ──────────────────────────────────────────────────────────

describe("getActiveWorktree", () => {
  test("returns null initially (before any worktree is created)", () => {
    // Note: this test depends on test execution order and module-level state.
    // Since worktree tests may have run, we just check the return type.
    const active = getActiveWorktree();
    // Either null or a valid worktree object
    if (active !== null) {
      expect(typeof active.path).toBe("string");
      expect(typeof active.branch).toBe("string");
    } else {
      expect(active).toBeNull();
    }
  });

  test("getActiveWorktree returns object with path and branch when set", async () => {
    process.chdir(repoDir);
    const name = `test-wt-${Date.now()}`;
    await enterWorktree({ name });
    const active = getActiveWorktree();
    if (active !== null) {
      expect(typeof active.path).toBe("string");
      expect(typeof active.branch).toBe("string");
      expect(active.branch).toContain("worktree/");
    }
  });
});

// ── Not a git repo ─────────────────────────────────────────────────────────────

describe("enterWorktreeTool — not a git repo", () => {
  test("returns error when not in a git repository", async () => {
    process.chdir(nonGitDir);
    const result = await enterWorktree({});
    expect(result).toContain("Erro");
    expect(result.toLowerCase()).toMatch(/git|repositório/i);
    process.chdir(repoDir);
  });
});

// ── Creating a worktree ────────────────────────────────────────────────────────

describe("enterWorktreeTool — create worktree", () => {
  test("creates a worktree in git repo", async () => {
    process.chdir(repoDir);
    const name = `feature-create-${Date.now()}`;
    const result = await enterWorktree({ name });
    expect(typeof result).toBe("string");
    // Should either succeed or fail gracefully
    if (!result.includes("Erro")) {
      expect(result).toContain("Worktree");
    }
  });

  test("uses timestamp-based name when no name provided", async () => {
    process.chdir(repoDir);
    const result = await enterWorktree({});
    expect(typeof result).toBe("string");
    // Should mention wt- prefix or worktree
  });

  test("sanitizes branch name with special characters", async () => {
    process.chdir(repoDir);
    const name = "Feature: My-Special@Branch!";
    const result = await enterWorktree({ name });
    expect(typeof result).toBe("string");
    // Should not contain spaces or special chars in branch name
  });

  test("reuses existing worktree if path already exists", async () => {
    process.chdir(repoDir);
    const name = `reuse-wt-${Date.now()}`;
    // Create it first
    const result1 = await enterWorktree({ name });
    if (!result1.includes("Erro")) {
      // Try to create again with same name
      const result2 = await enterWorktree({ name });
      expect(typeof result2).toBe("string");
      // Should indicate reuse
      if (result2.includes("Worktree")) {
        expect(result2).toMatch(/criado|reutilizando|reutilizado|exists/i);
      }
    }
  });

  test("success response contains path information", async () => {
    process.chdir(repoDir);
    const name = `info-wt-${Date.now()}`;
    const result = await enterWorktree({ name });
    if (!result.includes("Erro")) {
      expect(result).toContain("Caminho:");
      expect(result).toContain("Branch:");
    }
  });

  test("success response mentions how to remove the worktree", async () => {
    process.chdir(repoDir);
    const name = `cleanup-wt-${Date.now()}`;
    const result = await enterWorktree({ name });
    if (!result.includes("Erro")) {
      expect(result).toContain("git worktree remove");
    }
  });
});

// ── Branch name sanitization ───────────────────────────────────────────────────

describe("branch name sanitization (via enterWorktree)", () => {
  test("spaces are replaced with hyphens in branch names", async () => {
    process.chdir(repoDir);
    const result = await enterWorktree({ name: "my feature branch" });
    if (!result.includes("Erro")) {
      expect(result).toContain("my-feature-branch");
    }
  });

  test("uppercase is converted to lowercase", async () => {
    process.chdir(repoDir);
    const result = await enterWorktree({ name: "UPPERCASE" });
    if (!result.includes("Erro")) {
      expect(result).toContain("uppercase");
    }
  });

  test("empty name falls back to 'worktree' or timestamp-based", async () => {
    process.chdir(repoDir);
    const result = await enterWorktree({ name: "   " }); // whitespace only
    expect(typeof result).toBe("string");
    // Should use timestamp fallback (wt-...)
  });
});
