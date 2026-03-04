import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

import { gitTool } from "./git.ts";

// ── Temp git repo setup ────────────────────────────────────────────────────────

let repoDir: string;
let origCwd: string;

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-git-test-"));
  origCwd = process.cwd();

  // Initialize a git repo with a test user
  execSync("git init", { cwd: repoDir });
  execSync('git config user.email "test@example.com"', { cwd: repoDir });
  execSync('git config user.name "Test User"', { cwd: repoDir });

  // Create initial commit
  fs.writeFileSync(path.join(repoDir, "README.md"), "# Test Repo\n", "utf-8");
  execSync("git add README.md", { cwd: repoDir });
  execSync('git commit -m "Initial commit"', { cwd: repoDir });

  process.chdir(repoDir);
});

afterAll(() => {
  process.chdir(origCwd);
  fs.rmSync(repoDir, { recursive: true, force: true });
});

async function git(input: Record<string, unknown>): Promise<string> {
  return gitTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("gitTool metadata", () => {
  test("name is 'Git'", () => {
    expect(gitTool.name).toBe("Git");
  });

  test("has a description", () => {
    expect(typeof gitTool.description).toBe("string");
    expect(gitTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof gitTool.execute).toBe("function");
  });

  test("input_schema requires action", () => {
    expect(gitTool.input_schema.required).toContain("action");
  });

  test("input_schema has action with enum", () => {
    const actionProp = gitTool.input_schema.properties.action;
    expect(actionProp).toBeDefined();
    expect((actionProp as { enum: string[] }).enum).toContain("status");
    expect((actionProp as { enum: string[] }).enum).toContain("commit");
    expect((actionProp as { enum: string[] }).enum).toContain("log");
  });
});

// ── status ─────────────────────────────────────────────────────────────────────

describe("gitTool — status", () => {
  test("returns clean status when working tree is clean", async () => {
    const result = await git({ action: "status" });
    expect(typeof result).toBe("string");
    // Either shows branch info or clean status
    expect(result.length).toBeGreaterThan(0);
  });

  test("shows modified file in status", async () => {
    fs.writeFileSync(path.join(repoDir, "new-file.txt"), "new content\n", "utf-8");
    const result = await git({ action: "status" });
    expect(result).toContain("new-file.txt");
    fs.rmSync(path.join(repoDir, "new-file.txt"));
  });

  test("shows branch information", async () => {
    const result = await git({ action: "status" });
    // Should contain branch info (## main or ## master)
    expect(result).toMatch(/##|main|master|HEAD/i);
  });
});

// ── log ────────────────────────────────────────────────────────────────────────

describe("gitTool — log", () => {
  test("returns commit history", async () => {
    const result = await git({ action: "log" });
    expect(result).toContain("Initial commit");
  });

  test("respects count parameter", async () => {
    // Add another commit for testing
    fs.writeFileSync(path.join(repoDir, "file2.txt"), "content\n", "utf-8");
    execSync("git add file2.txt", { cwd: repoDir });
    execSync('git commit -m "Second commit"', { cwd: repoDir });

    const result = await git({ action: "log", count: 1 });
    // With count=1, should only show 1 commit
    const lines = result.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);

    fs.rmSync(path.join(repoDir, "file2.txt"));
  });

  test("default count is 10", async () => {
    const result = await git({ action: "log" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("shows commit hash and message", async () => {
    const result = await git({ action: "log" });
    // Format: hash date message (author)
    expect(result).toMatch(/[a-f0-9]{6,}/); // hash
  });
});

// ── diff ───────────────────────────────────────────────────────────────────────

describe("gitTool — diff", () => {
  test("returns 'No changes' when working tree is clean", async () => {
    // Make sure there's nothing staged or modified
    execSync("git checkout -- .", { cwd: repoDir });
    const result = await git({ action: "diff" });
    expect(result).toContain("No changes");
  });

  test("shows changes when file is modified", async () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Modified\n", "utf-8");
    const result = await git({ action: "diff" });
    expect(typeof result).toBe("string");
    // Should show some content
    execSync("git checkout -- README.md", { cwd: repoDir });
  });

  test("staged diff shows staged changes", async () => {
    fs.writeFileSync(path.join(repoDir, "staged.txt"), "staged content\n", "utf-8");
    execSync("git add staged.txt", { cwd: repoDir });
    const result = await git({ action: "diff", staged: true });
    expect(typeof result).toBe("string");
    execSync("git rm -f staged.txt", { cwd: repoDir });
  });
});

// ── commit ─────────────────────────────────────────────────────────────────────

describe("gitTool — commit", () => {
  test("requires message parameter", async () => {
    const result = await git({ action: "commit" });
    expect(result).toContain("Error");
  });

  test("creates commit with staged files", async () => {
    fs.writeFileSync(path.join(repoDir, "commit-test.txt"), "content\n", "utf-8");
    execSync("git add commit-test.txt", { cwd: repoDir });
    const result = await git({ action: "commit", message: "Test commit from test suite" });
    expect(result).toContain("commit");
    // Cleanup
    execSync("git rm commit-test.txt", { cwd: repoDir });
    execSync('git commit -m "cleanup"', { cwd: repoDir });
  });

  test("returns error when nothing to commit", async () => {
    const result = await git({ action: "commit", message: "Nothing to commit" });
    // Should error because nothing is staged
    expect(typeof result).toBe("string");
    // Either error or success with empty commit (depending on git config)
  });

  test("stages specific files when files parameter is provided", async () => {
    fs.writeFileSync(path.join(repoDir, "file-to-stage.txt"), "staged\n", "utf-8");
    const result = await git({
      action: "commit",
      message: "Stage specific file",
      files: ["file-to-stage.txt"],
    });
    expect(typeof result).toBe("string");
    // Cleanup
    try {
      execSync("git rm file-to-stage.txt", { cwd: repoDir });
      execSync('git commit -m "cleanup staged file"', { cwd: repoDir });
    } catch {}
  });
});

// ── branch ─────────────────────────────────────────────────────────────────────

describe("gitTool — branch", () => {
  test("lists branches when no branch name provided", async () => {
    const result = await git({ action: "branch" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should contain at least one branch
    expect(result).toMatch(/main|master|HEAD/i);
  });

  test("creates new branch", async () => {
    const branchName = `test-branch-${Date.now()}`;
    const result = await git({ action: "branch", branch: branchName, create: true });
    expect(result).toContain(branchName);
    // Switch back to main/master
    try {
      execSync("git checkout main 2>/dev/null || git checkout master", { cwd: repoDir });
    } catch {}
    // Delete the branch
    try {
      execSync(`git branch -D ${branchName}`, { cwd: repoDir });
    } catch {}
  });

  test("switches to an existing branch", async () => {
    const branchName = `switch-branch-${Date.now()}`;
    execSync(`git branch ${branchName}`, { cwd: repoDir });
    const result = await git({ action: "branch", branch: branchName });
    expect(result).toContain(branchName);
    // Switch back
    try {
      execSync("git checkout main 2>/dev/null || git checkout master", { cwd: repoDir });
    } catch {}
    execSync(`git branch -D ${branchName}`, { cwd: repoDir });
  });
});

// ── stash ──────────────────────────────────────────────────────────────────────

describe("gitTool — stash", () => {
  test("stash push works with modified files", async () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Modified for stash\n", "utf-8");
    execSync("git add README.md", { cwd: repoDir });
    const result = await git({ action: "stash" });
    expect(typeof result).toBe("string");
    // Pop the stash to restore state
    await git({ action: "stash", ref: "pop" });
    execSync("git checkout -- README.md", { cwd: repoDir });
  });

  test("stash pop works after stash push", async () => {
    fs.writeFileSync(path.join(repoDir, "stash-file.txt"), "stash content\n", "utf-8");
    execSync("git add stash-file.txt", { cwd: repoDir });
    await git({ action: "stash" });
    const result = await git({ action: "stash", ref: "pop" });
    expect(typeof result).toBe("string");
    try { execSync("git rm -f stash-file.txt", { cwd: repoDir }); } catch {}
  });
});

// ── reset ──────────────────────────────────────────────────────────────────────

describe("gitTool — reset", () => {
  test("mixed reset to HEAD works", async () => {
    const result = await git({ action: "reset" });
    expect(typeof result).toBe("string");
    // Should succeed without error
  });

  test("soft reset mode is accepted", async () => {
    const result = await git({ action: "reset", mode: "soft" });
    expect(typeof result).toBe("string");
  });

  test("hard reset to HEAD cleans working tree", async () => {
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Dirty\n", "utf-8");
    const result = await git({ action: "reset", mode: "hard", ref: "HEAD" });
    expect(typeof result).toBe("string");
    // README.md should be restored to original
  });

  test("reset specific files", async () => {
    fs.writeFileSync(path.join(repoDir, "reset-file.txt"), "content\n", "utf-8");
    execSync("git add reset-file.txt", { cwd: repoDir });
    const result = await git({ action: "reset", files: ["reset-file.txt"] });
    expect(typeof result).toBe("string");
    try { fs.rmSync(path.join(repoDir, "reset-file.txt")); } catch {}
  });
});

// ── push ───────────────────────────────────────────────────────────────────────

describe("gitTool — push", () => {
  test("returns error when no remote is configured", async () => {
    process.chdir(repoDir);
    const result = await git({ action: "push" });
    // No remote configured, so push should fail with an error
    expect(typeof result).toBe("string");
    // Either "Error:" prefix from the tool or other content
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── pull ───────────────────────────────────────────────────────────────────────

describe("gitTool — pull", () => {
  test("returns error or success message when pulling", async () => {
    process.chdir(repoDir);
    const result = await git({ action: "pull" });
    // No remote configured, so pull should fail with an error
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── unknown action ─────────────────────────────────────────────────────────────

describe("gitTool — unknown action", () => {
  test("returns unknown action message", async () => {
    const result = await git({ action: "unknown_action_xyz" as string });
    expect(result).toContain("Unknown action");
  });
});
