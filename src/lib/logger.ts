/**
 * Centralized structured logger for Sofik AI.
 *
 * Writes JSON Lines (one JSON object per line) to:
 *   ~/.sofik-ai/logs/YYYY-MM-DD-<category>.log
 *
 * Categories: app | llm | tool | permission | session | db | auth | job | mcp | error
 * Levels:     debug | info | warn | error
 *
 * All I/O is synchronous+append so logs are never lost on crash.
 * Failures to write are silently ignored — logging must never crash the app.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory =
  | "app"
  | "llm"
  | "tool"
  | "permission"
  | "session"
  | "db"
  | "auth"
  | "job"
  | "mcp"
  | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  cat: LogCategory;
  session?: string;
  msg: string;
  data?: Record<string, unknown>;
}

// ── State ─────────────────────────────────────────────────────────────────────

export const LOG_DIR = join(os.homedir(), ".sofik", "logs");

let _sessionId: string | undefined;
let _dirReady = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!_dirReady) {
    try {
      mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      // If we can't create the dir, logging is silently disabled
    }
    _dirReady = true;
  }
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function write(cat: LogCategory, level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  ensureDir();

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    cat,
    ..._sessionId ? { session: _sessionId } : {},
    msg,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };

  const line = JSON.stringify(entry) + "\n";
  const day = datestamp();

  // Write to category-specific file
  try {
    appendFileSync(join(LOG_DIR, `${day}-${cat}.log`), line);
  } catch {
    // Silent — never crash the app because of logging
  }

  // Also mirror errors to the unified error log
  if (level === "error" && cat !== "error") {
    try {
      appendFileSync(join(LOG_DIR, `${day}-error.log`), line);
    } catch {
      // Silent
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Set the active session ID (included in every subsequent log entry) */
export function setLogSession(id: string): void {
  _sessionId = id;
}

/** Get the current log directory path */
export function getLogDir(): string {
  return LOG_DIR;
}

// ── Convenience methods per category ─────────────────────────────────────────

export const logger = {
  // ── Session management ────────────────────────────────────────────────────
  setSession(id: string) {
    setLogSession(id);
  },

  // ── Generic ──────────────────────────────────────────────────────────────
  debug(msg: string, data?: Record<string, unknown>) {
    write("app", "debug", msg, data);
  },
  info(msg: string, data?: Record<string, unknown>) {
    write("app", "info", msg, data);
  },
  warn(msg: string, data?: Record<string, unknown>) {
    write("app", "warn", msg, data);
  },
  error(msg: string, data?: Record<string, unknown>) {
    write("error", "error", msg, data);
  },

  // ── App lifecycle ─────────────────────────────────────────────────────────
  app: {
    info(msg: string, data?: Record<string, unknown>) { write("app", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("app", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("app", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("app", "debug", msg, data); },
  },

  // ── LLM API ──────────────────────────────────────────────────────────────
  llm: {
    info(msg: string, data?: Record<string, unknown>) { write("llm", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("llm", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("llm", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("llm", "debug", msg, data); },
  },

  // ── Tool execution ────────────────────────────────────────────────────────
  tool: {
    info(msg: string, data?: Record<string, unknown>) { write("tool", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("tool", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("tool", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("tool", "debug", msg, data); },
  },

  // ── Permission system ─────────────────────────────────────────────────────
  permission: {
    info(msg: string, data?: Record<string, unknown>) { write("permission", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("permission", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("permission", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("permission", "debug", msg, data); },
  },

  // ── Session persistence ───────────────────────────────────────────────────
  session: {
    info(msg: string, data?: Record<string, unknown>) { write("session", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("session", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("session", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("session", "debug", msg, data); },
  },

  // ── Database ──────────────────────────────────────────────────────────────
  db: {
    info(msg: string, data?: Record<string, unknown>) { write("db", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("db", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("db", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("db", "debug", msg, data); },
  },

  // ── Authentication ────────────────────────────────────────────────────────
  auth: {
    info(msg: string, data?: Record<string, unknown>) { write("auth", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("auth", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("auth", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("auth", "debug", msg, data); },
  },

  // ── Job queue ─────────────────────────────────────────────────────────────
  job: {
    info(msg: string, data?: Record<string, unknown>) { write("job", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("job", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("job", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("job", "debug", msg, data); },
  },

  // ── MCP servers ───────────────────────────────────────────────────────────
  mcp: {
    info(msg: string, data?: Record<string, unknown>) { write("mcp", "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { write("mcp", "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>) { write("mcp", "error", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { write("mcp", "debug", msg, data); },
  },
};
