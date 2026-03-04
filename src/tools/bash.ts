import { spawn } from "child_process";
import { randomBytes } from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";
import { backgroundTaskRegistry, notifyTaskComplete } from "../lib/backgroundTasks.ts";
import type { BackgroundTask } from "../lib/backgroundTasks.ts";

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

let shellCwd = process.cwd();

function truncate(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  const half = Math.floor(MAX_OUTPUT_CHARS / 2);
  return (
    output.slice(0, half) +
    `\n\n[... ${output.length - MAX_OUTPUT_CHARS} chars truncated ...]\n\n` +
    output.slice(-half)
  );
}

function getOutputPath(taskId: string): string {
  return path.join(os.homedir(), ".sofik", "agent-output", `${taskId}.output`);
}

export const bashTool: ToolDefinition = {
  name: "Bash",
  description: `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)
 - Communication: Output text directly (NOT echo/printf)
While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
 - If your command will create new directories or files, first use this tool to run \`ls\` to verify the parent directory exists and is the correct location.
 - Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
 - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
 - You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).
 - You can use the \`run_in_background\` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. Use TaskOutput to read the output. Use TaskStop to cancel.
 - Write a clear, concise description of what your command does. For simple commands, keep it brief (5-10 words). For complex commands (piped commands, obscure flags, or anything hard to understand at a glance), include enough context so that the user can understand what your command will do.
 - When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. Example: if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
 - For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
 - Avoid unnecessary \`sleep\` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - Do not retry failing commands in a sleep loop — diagnose the root cause or consider an alternative approach.
  - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.`,
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default 120000)",
      },
      description: {
        type: "string",
        description: "Short description of what this command does",
      },
      run_in_background: {
        type: "boolean",
        description: "If true, executes the command without blocking and returns immediately with a task_id. Use TaskOutput to retrieve the result. Use TaskStop to cancel.",
      },
    },
    required: ["command"],
  },
  async execute(input) {
    const command = input["command"] as string;
    const description = input["description"] as string | undefined;
    const timeout = (input["timeout"] as number | undefined) ?? TIMEOUT_MS;
    const runInBackground = (input["run_in_background"] as boolean | undefined) ?? false;

    // ── Background mode ────────────────────────────────────────────────────────
    if (runInBackground) {
      const taskId = `bash-${randomBytes(8).toString("hex")}`;
      const outputFile = getOutputPath(taskId);
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });

      const controller = new AbortController();
      let partialOutput = "";

      const proc = spawn("bash", ["-c", command], {
        cwd: shellCwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      controller.signal.addEventListener("abort", () => {
        proc.kill("SIGKILL");
      });

      const promise = new Promise<string>((resolve) => {
        proc.stdout.on("data", (d: Buffer) => {
          const chunk = d.toString();
          partialOutput += chunk;
          const task = backgroundTaskRegistry.get(taskId);
          if (task) task.partialOutput = partialOutput;
          try { fs.appendFileSync(outputFile, chunk, "utf8"); } catch { /* ignore */ }
        });
        proc.stderr.on("data", (d: Buffer) => {
          const chunk = d.toString();
          partialOutput += chunk;
          const task = backgroundTaskRegistry.get(taskId);
          if (task) task.partialOutput = partialOutput;
          try { fs.appendFileSync(outputFile, chunk, "utf8"); } catch { /* ignore */ }
        });
        proc.on("close", (code) => {
          const task = backgroundTaskRegistry.get(taskId);
          if (task) {
            if (task.status !== "stopped") {
              task.status = code === 0 ? "completed" : "failed";
            }
            task.endedAt = Date.now();
            task.partialOutput = partialOutput;
          }
          notifyTaskComplete(taskId);
          resolve(partialOutput);
        });
        proc.on("error", (err) => {
          const task = backgroundTaskRegistry.get(taskId);
          if (task) {
            if (task.status !== "stopped") task.status = "failed";
            task.endedAt = Date.now();
          }
          notifyTaskComplete(taskId);
          resolve(`Error: ${err.message}`);
        });
      });

      const bgTask: BackgroundTask = {
        taskId,
        type: "bash",
        description: description ?? command.slice(0, 100),
        status: "running",
        partialOutput: "",
        outputFile,
        promise,
        controller,
        startedAt: Date.now(),
      };
      backgroundTaskRegistry.set(taskId, bgTask);

      logger.tool.info("Bash: iniciado em background", {
        taskId,
        command: command.slice(0, 200),
        description,
        cwd: shellCwd,
      });

      return JSON.stringify({
        taskId,
        outputFile,
        status: "running",
        message: `Bash command started in background. Use TaskOutput tool with task_id: "${taskId}" to retrieve results. Use TaskStop with task_id: "${taskId}" to cancel.`,
      });
    }

    // ── Foreground mode ────────────────────────────────────────────────────────
    const commandWithCwd = `${command}\necho "__CWD__=$(pwd)"`;

    const start = Date.now();
    logger.tool.info("Bash: iniciando execução", {
      command: command.slice(0, 500),
      description,
      cwd: shellCwd,
      timeoutMs: timeout,
    });

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn("bash", ["-c", commandWithCwd], {
        cwd: shellCwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          logger.tool.warn("Bash: timeout", { command: command.slice(0, 200), timeoutMs: timeout, durationMs: Date.now() - start });
          resolve(`Erro: Comando expirou após ${timeout}ms\n${stdout}`);
          return;
        }

        // Extract and update CWD from output
        const cwdMatch = stdout.match(/__CWD__=(.+)$/m);
        if (cwdMatch) {
          shellCwd = cwdMatch[1]!.trim();
          stdout = stdout.replace(/__CWD__=.+\n?$/m, "");
        }

        let result = "";
        if (stdout.trimEnd()) result += stdout.trimEnd();
        if (stderr) result += (result ? "\n" : "") + stderr;
        if (!result) result = "(sem saída)";
        if (code !== 0) {
          result = `Código de saída: ${code}\n${result}`;
        }

        const truncated = result.length > MAX_OUTPUT_CHARS;
        logger.tool.info("Bash: concluído", {
          command: command.slice(0, 200),
          exitCode: code,
          durationMs: Date.now() - start,
          outputLength: result.length,
          truncated,
          newCwd: shellCwd,
        });

        resolve(truncate(result));
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        logger.tool.error("Bash: erro de processo", { command: command.slice(0, 200), error: err.message, durationMs: Date.now() - start });
        resolve(`Erro: ${err.message}`);
      });
    });
  },
};
