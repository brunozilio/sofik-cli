import type { ToolDefinition } from "../lib/types.ts";

type GitAction = "status" | "diff" | "log" | "commit" | "push" | "pull" | "branch" | "stash" | "reset";

async function runGit(args: string[], cwd = process.cwd()): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export const gitTool: ToolDefinition = {
  name: "Git",
  description: `Execute structured git operations. Safer than running arbitrary git commands via Bash.

Supported actions:
- status: Show working tree status
- diff: Show changes (optionally staged)
- log: Show commit history (last N commits)
- commit: Create a commit with a message
- push: Push to remote (requires explicit confirmation)
- pull: Pull from remote
- branch: List, create, or switch branches
- stash: Stash or pop changes
- reset: Reset files (soft/mixed/hard)`,
  input_schema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["status", "diff", "log", "commit", "push", "pull", "branch", "stash", "reset"],
        description: "The git action to perform",
      },
      message: {
        type: "string",
        description: "Commit message (for 'commit' action)",
      },
      staged: {
        type: "boolean",
        description: "Show only staged changes (for 'diff' action)",
      },
      count: {
        type: "number",
        description: "Number of commits to show (for 'log' action, default: 10)",
      },
      branch: {
        type: "string",
        description: "Branch name (for 'branch' action to create/switch)",
      },
      create: {
        type: "boolean",
        description: "Create new branch (for 'branch' action)",
      },
      mode: {
        type: "string",
        enum: ["soft", "mixed", "hard"],
        description: "Reset mode (for 'reset' action, default: mixed)",
      },
      ref: {
        type: "string",
        description: "Git ref to reset to (for 'reset' action, default: HEAD)",
      },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Specific files to stage before commit, or files to reset",
      },
    },
    required: ["action"],
  },
  async execute(input) {
    const action = input["action"] as GitAction;

    switch (action) {
      case "status": {
        const { stdout, stderr, exitCode } = await runGit(["status", "--short", "--branch"]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout || "Nothing to report — working tree clean";
      }

      case "diff": {
        const staged = input["staged"] as boolean | undefined;
        const args = ["diff"];
        if (staged) args.push("--staged");
        args.push("--stat");
        const { stdout: statOut } = await runGit(args);
        const { stdout: diffOut, exitCode } = await runGit([...args.filter(a => a !== "--stat")]);
        if (exitCode !== 0) return `Error running diff`;
        const lines = diffOut.split("\n");
        const preview = lines.slice(0, 50).join("\n");
        const summary = statOut.trim();
        return [summary, preview.length > 0 ? "\n" + preview : "", lines.length > 50 ? `\n... (${lines.length - 50} more lines)` : ""].join("").trim() || "No changes";
      }

      case "log": {
        const count = (input["count"] as number | undefined) ?? 10;
        const { stdout, exitCode, stderr } = await runGit([
          "log", `--max-count=${count}`,
          "--pretty=format:%h %as %s (%an)",
        ]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout || "No commits yet";
      }

      case "commit": {
        const message = input["message"] as string | undefined;
        if (!message) return "Error: commit message required";
        const files = input["files"] as string[] | undefined;

        // Stage files if specified, otherwise stage all tracked changes
        if (files && files.length > 0) {
          const { exitCode, stderr } = await runGit(["add", ...files]);
          if (exitCode !== 0) return `Error staging files: ${stderr}`;
        }

        const { stdout, stderr, exitCode } = await runGit(["commit", "-m", message]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout.trim();
      }

      case "push": {
        const { stdout, stderr, exitCode } = await runGit(["push"]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout.trim() || "Pushed successfully";
      }

      case "pull": {
        const { stdout, stderr, exitCode } = await runGit(["pull"]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout.trim() || "Already up to date";
      }

      case "branch": {
        const branchName = input["branch"] as string | undefined;
        const create = input["create"] as boolean | undefined;

        if (!branchName) {
          // List branches
          const { stdout, stderr, exitCode } = await runGit(["branch", "-v"]);
          if (exitCode !== 0) return `Error: ${stderr}`;
          return stdout || "No branches";
        }

        if (create) {
          const { stdout, stderr, exitCode } = await runGit(["checkout", "-b", branchName]);
          if (exitCode !== 0) return `Error: ${stderr}`;
          return `Created and switched to branch: ${branchName}\n${stdout}`.trim();
        }

        // Switch branch
        const { stdout, stderr, exitCode } = await runGit(["checkout", branchName]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return `Switched to branch: ${branchName}\n${stdout}`.trim();
      }

      case "stash": {
        const ref = input["ref"] as string | undefined;
        if (ref === "pop") {
          const { stdout, stderr, exitCode } = await runGit(["stash", "pop"]);
          if (exitCode !== 0) return `Error: ${stderr}`;
          return stdout.trim() || "Stash applied";
        }
        const { stdout, stderr, exitCode } = await runGit(["stash", "push"]);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout.trim() || "Changes stashed";
      }

      case "reset": {
        const mode = (input["mode"] as string | undefined) ?? "mixed";
        const ref = (input["ref"] as string | undefined) ?? "HEAD";
        const files = input["files"] as string[] | undefined;

        if (files && files.length > 0) {
          const { stdout, stderr, exitCode } = await runGit(["reset", ref, "--", ...files]);
          if (exitCode !== 0) return `Error: ${stderr}`;
          return `Reset files to ${ref}:\n${files.join("\n")}`;
        }

        const args = mode === "hard" ? ["reset", "--hard", ref] : ["reset", `--${mode}`, ref];
        const { stdout, stderr, exitCode } = await runGit(args);
        if (exitCode !== 0) return `Error: ${stderr}`;
        return stdout.trim() || `Reset to ${ref} (${mode})`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
};
