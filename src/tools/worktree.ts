import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { ToolDefinition } from "../lib/types.ts";

// ─── State ─────────────────────────────────────────────────────────────────

let activeWorktreePath: string | null = null;
let activeWorktreeBranch: string | null = null;

export function getActiveWorktree(): { path: string; branch: string } | null {
  if (!activeWorktreePath || !activeWorktreeBranch) return null;
  return { path: activeWorktreePath, branch: activeWorktreeBranch };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(dir: string): string {
  try {
    return execSync("git branch --show-current", {
      cwd: dir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "HEAD";
  }
}

function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "worktree";
}

// ─── Tool ──────────────────────────────────────────────────────────────────

export const enterWorktreeTool: ToolDefinition = {
  name: "EnterWorktree",
  description:
    "Create an isolated git worktree for the current repository, allowing you to work on changes " +
    "without affecting the main branch. The worktree gets a fresh branch based on HEAD. " +
    "Use this when the user explicitly asks to work in a worktree, or when making large changes " +
    "that should be isolated (e.g., for a feature branch or parallel task). " +
    "The worktree is created inside .sofik/worktrees/ in the project root.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Optional name for the worktree branch/directory. " +
          "A descriptive name like 'feature-auth' or 'fix-bug-123'. " +
          "If not provided, a name is generated from the current timestamp.",
      },
    },
    required: [],
  },
  async execute(input) {
    const cwd = process.cwd();

    if (!isGitRepo(cwd)) {
      return "Erro: Não está em um repositório git. EnterWorktree requer git.";
    }

    const rawName = String(input["name"] ?? "").trim();
    const branchSuffix = rawName
      ? sanitizeBranchName(rawName)
      : `wt-${Date.now().toString(36)}`;

    const currentBranch = getCurrentBranch(cwd);
    const newBranch = `worktree/${branchSuffix}`;

    // Find git root
    let gitRoot: string;
    try {
      gitRoot = execSync("git rev-parse --show-toplevel", {
        cwd,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "Erro: Não foi possível determinar o diretório raiz do git.";
    }

    const worktreesBase = path.join(gitRoot, ".sofik", "worktrees");
    const worktreePath = path.join(worktreesBase, branchSuffix);

    // Don't create if already exists
    if (fs.existsSync(worktreePath)) {
      activeWorktreePath = worktreePath;
      activeWorktreeBranch = newBranch;
      return (
        `Worktree já existe em: ${worktreePath}\n` +
        `Branch: ${newBranch}\n` +
        `Reutilizando worktree existente.`
      );
    }

    fs.mkdirSync(worktreesBase, { recursive: true });

    try {
      execSync(`git worktree add -b "${newBranch}" "${worktreePath}"`, {
        cwd: gitRoot,
        encoding: "utf-8",
      });
    } catch (err) {
      return `Erro ao criar worktree: ${err instanceof Error ? err.message : String(err)}`;
    }

    activeWorktreePath = worktreePath;
    activeWorktreeBranch = newBranch;

    return [
      `Worktree criado com sucesso.`,
      ``,
      `Caminho:       ${worktreePath}`,
      `Branch:        ${newBranch}`,
      `Baseado em:    ${currentBranch}`,
      ``,
      `Você está agora trabalhando no worktree isolado. Alterações aqui não afetarão ${currentBranch}.`,
      `Quando terminar, o worktree pode ser mesclado ou removido com:`,
      `  git worktree remove "${worktreePath}"`,
    ].join("\n");
  },
};
