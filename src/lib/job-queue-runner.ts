import React from "react";
import fs from "fs";
import path from "path";
import { execSync as _execSync } from "child_process";
import { dbRun as _dbRun } from "../db/index.ts";
import {
  createTask,
  getNextPendingTask,
  updateTaskStatus,
  updateTaskPlan,
} from "../db/queries/tasks.ts";
import { getPermissionMode, type PermissionMode } from "./permissions.ts";
import type { Message, TurnEvent } from "./types.ts";
import type { Session } from "./session.ts";

// ─── Deps interface ──────────────────────────────────────────────────────────

export interface JobQueueRunnerDeps {
  messagesRef: React.MutableRefObject<Message[]>;
  session: React.MutableRefObject<Session>;
  setMessages: (msgs: Message[]) => void;
  setTurnEvents: (evts: TurnEvent[]) => void;
  setSystemMessage: (msg: string | null) => void;
  runAI: (msgs: Message[]) => Promise<Message[]>;
  changeMode: (mode: PermissionMode) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createJobQueueRunner(deps: JobQueueRunnerDeps) {
  const {
    messagesRef,
    session,
    setMessages,
    setTurnEvents,
    setSystemMessage,
    runAI,
    changeMode,
    abortControllerRef,
  } = deps;

  // Internal ref for tracking which task is currently running
  const currentTaskIdRef = { current: null as string | null };
  const planningTaskIdRef = { current: null as string | null };

  function tryCreateWorktree(taskId: string): { path: string; branch: string } | null {
    try {
      const shortId = taskId.slice(0, 8);
      const branch = `task/${shortId}`;
      const worktreePath = path.join(process.cwd(), ".sofik", "worktrees", `task-${shortId}`);
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      _execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
        cwd: process.cwd(),
        stdio: "pipe",
      });
      return { path: worktreePath, branch };
    } catch {
      return null;
    }
  }

  function startTaskPlanning(context: string) {
    const task = createTask(context, { status: "planning" });
    const worktree = tryCreateWorktree(task.id);
    if (worktree) {
      _dbRun(
        "UPDATE tasks SET worktree_path = ?, worktree_branch = ?, updated_at = ? WHERE id = ?",
        [worktree.path, worktree.branch, new Date().toISOString(), task.id]
      );
    }

    planningTaskIdRef.current = task.id;
    changeMode("plan");

    const worktreeCtx = worktree
      ? "\n\nWorktree: " + worktree.path + " (branch: " + worktree.branch + ")\nExplore e planeje dentro deste diretório."
      : "";

    const planningMsg = [
      "[Tarefa " + task.id.slice(0, 8) + " — Planejamento]",
      "Você está no MODO DE PLANEJAMENTO. Explore o código, projete uma abordagem e então chame ExitPlanMode com seu plano.",
      worktreeCtx,
      "\n\nTarefa:\n" + context,
    ].join("\n");

    const planMsgs: Message[] = [
      ...messagesRef.current,
      { role: "user", content: planningMsg },
    ];
    setMessages(planMsgs);
    session.current.messages = planMsgs;
    setTurnEvents([]);
    setSystemMessage(`Tarefa [${task.id.slice(0, 8)}] criada. Entrando no modo de planejamento — pressione y para aprovar, n para rejeitar.`);
    runAI(planMsgs);
  }

  async function runTaskQueue() {
    let nextTask = getNextPendingTask();
    if (!nextTask) {
      setSystemMessage("Nenhuma tarefa pendente na fila.");
      return;
    }

    // Switch to auto mode for unattended execution
    const prevMode = getPermissionMode();
    changeMode("auto");

    try {
      while (nextTask) {
        const task = nextTask;
        updateTaskStatus(task.id, "running", { started_at: new Date().toISOString() });
        currentTaskIdRef.current = task.id;

        const worktreeCtx = task.worktree_path
          ? `
Worktree: ${task.worktree_path} (branch: ${task.worktree_branch})
Todas as operações de arquivo devem ser feitas dentro do diretório worktree.`
          : "";
        const planCtx = task.plan
          ? `

Plano aprovado:
${task.plan}`
          : "";

        const executionMsg = [
          `[Tarefa ${task.id.slice(0, 8)}] Execute a seguinte tarefa de forma autônoma sem pedir confirmação.`,
          worktreeCtx,
          planCtx,
          `
Tarefa:
${task.context}`,
        ].join("");

        const taskMessages: Message[] = [
          { role: "user", content: executionMsg },
        ];
        setMessages(taskMessages);
        session.current.messages = taskMessages;
        setTurnEvents([]);

        await runAI(taskMessages);
        updateTaskStatus(task.id, "done", { completed_at: new Date().toISOString() });
        currentTaskIdRef.current = null;

        nextTask = getNextPendingTask();
      }
    } finally {
      changeMode(prevMode as Parameters<typeof changeMode>[0]);
      currentTaskIdRef.current = null;
    }

    setSystemMessage("✓ Todas as tarefas da fila foram concluídas.");
  }

  return {
    runTaskQueue,
    startTaskPlanning,
    tryCreateWorktree,
    planningTaskIdRef,
    currentTaskIdRef,
  };
}
