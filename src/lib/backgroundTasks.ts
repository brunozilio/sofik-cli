// ── Unified Background Task Registry ──────────────────────────────────────────
// Central registry for all background tasks (agents and bash commands).

import { logger } from "./logger.ts";

export interface BackgroundTask {
  taskId: string;
  type: "agent" | "bash";
  description: string;
  status: "running" | "completed" | "failed" | "stopped";
  partialOutput: string;
  outputFile: string;
  promise: Promise<string>;
  controller: AbortController;
  startedAt: number;
  endedAt?: number;
  transcriptFile?: string;
}

export const backgroundTaskRegistry = new Map<string, BackgroundTask>();

// Listeners for UI completion notifications
const completionListeners: Array<(task: BackgroundTask) => void> = [];

export function onBackgroundTaskComplete(cb: (task: BackgroundTask) => void): () => void {
  completionListeners.push(cb);
  return () => {
    const idx = completionListeners.indexOf(cb);
    if (idx !== -1) completionListeners.splice(idx, 1);
  };
}

export function notifyTaskComplete(taskId: string): void {
  const task = backgroundTaskRegistry.get(taskId);
  if (!task) return;
  logger.tool.info("Background task concluído", {
    taskId,
    type: task.type,
    status: task.status,
    description: task.description,
    durationMs: task.endedAt ? task.endedAt - task.startedAt : undefined,
    outputLength: task.partialOutput.length,
  });
  for (const cb of completionListeners) {
    try { cb(task); } catch { /* ignore */ }
  }
}
