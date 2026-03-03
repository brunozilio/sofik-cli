import fs from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";
import type { Message } from "./types.ts";

const SESSIONS_DIR = path.join(os.homedir(), ".sofik", "sessions");

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  cwd: string;
  messages: Message[];
  title?: string;
}

function sessionsDir(): string {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  return SESSIONS_DIR;
}

function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(id: string): Session | null {
  try {
    const raw = fs.readFileSync(sessionPath(id), "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function listSessions(): Array<{
  id: string;
  updatedAt: string;
  model: string;
  cwd: string;
  messageCount: number;
  title?: string;
}> {
  try {
    const dir = sessionsDir();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf-8");
          const s = JSON.parse(raw) as Session;
          return {
            id: s.id,
            updatedAt: s.updatedAt,
            model: s.model,
            cwd: s.cwd,
            messageCount: s.messages.length,
            title: s.title,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/** Search sessions by content — returns sessions where any message contains the query */
export function searchSessions(query: string): Array<{
  id: string;
  updatedAt: string;
  model: string;
  cwd: string;
  messageCount: number;
  title?: string;
}> {
  const q = query.toLowerCase();
  try {
    const dir = sessionsDir();
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const raw = fs.readFileSync(path.join(dir, f), "utf-8");
          const s = JSON.parse(raw) as Session;
          // Search in all message content
          const matches = s.messages.some((m) => {
            const content = typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content);
            return content.toLowerCase().includes(q);
          });
          if (!matches) return null;
          return {
            id: s.id,
            updatedAt: s.updatedAt,
            model: s.model,
            cwd: s.cwd,
            messageCount: s.messages.length,
            title: s.title,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function createSession(model: string): Session {
  return {
    id: generateSessionId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    cwd: process.cwd(),
    messages: [],
  };
}

// ─── Project Memory ───────────────────────────────────────────────────────

/** Stable short hash for a directory path (used to namespace project memory) */
export function projectHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

/** Directory where this project's memory is stored */
export function getProjectMemoryDir(cwd = process.cwd()): string {
  const hash = projectHash(cwd);
  return path.join(os.homedir(), ".sofik", "projects", hash, "memory");
}

/** Read the project-specific MEMORY.md, returns null if it doesn't exist */
export function loadProjectMemory(cwd = process.cwd()): string | null {
  const memPath = path.join(getProjectMemoryDir(cwd), "MEMORY.md");
  try {
    return fs.readFileSync(memPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Ensure the project memory directory exists and return the MEMORY.md path.
 * Used by agents to save memory.
 */
export function ensureProjectMemoryPath(cwd = process.cwd()): string {
  const dir = getProjectMemoryDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "MEMORY.md");
}
