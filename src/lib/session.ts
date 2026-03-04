import fs from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";
import type { Message } from "./types.ts";
import { logger } from "./logger.ts";

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

function sessionJsonlPath(id: string): string {
  return path.join(sessionsDir(), `${id}.jsonl`);
}

export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── JSONL helpers ─────────────────────────────────────────────────────────────

interface SessionHeader {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  cwd: string;
  title?: string;
}

function writeJsonl(session: Session): void {
  const jsonlPath = sessionJsonlPath(session.id);
  const header: SessionHeader = {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    cwd: session.cwd,
    title: session.title,
  };
  const lines = [
    JSON.stringify({ __header: true, ...header }),
    ...session.messages.map((m) => JSON.stringify(m)),
  ];
  fs.writeFileSync(jsonlPath, lines.join("\n") + "\n", "utf-8");
}

function readJsonl(id: string): Session | null {
  const jsonlPath = sessionJsonlPath(id);
  try {
    const raw = fs.readFileSync(jsonlPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;
    const header = JSON.parse(lines[0]!) as SessionHeader & { __header?: boolean };
    const messages = lines.slice(1).map((l) => JSON.parse(l) as Message);
    return {
      id: header.id,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      model: header.model,
      cwd: header.cwd,
      title: header.title,
      messages,
    };
  } catch {
    return null;
  }
}

/** Append a single message to the JSONL file (O(1) write). */
export function appendMessageToSession(id: string, message: Message): void {
  const jsonlPath = sessionJsonlPath(id);
  try {
    fs.appendFileSync(jsonlPath, JSON.stringify(message) + "\n", "utf-8");
  } catch { /* ignore — main saveSession will catch up */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();

  // Primary: JSONL
  try {
    writeJsonl(session);
  } catch (err) {
    logger.session.warn("Falha ao salvar sessão em JSONL", { sessionId: session.id, error: String(err) });
  }

  // Compatibility: also keep JSON (for tools that read .json)
  try {
    fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), "utf-8");
  } catch { /* ignore */ }

  logger.session.info("Sessão salva", {
    sessionId: session.id,
    model: session.model,
    messageCount: session.messages.length,
    cwd: session.cwd,
    title: session.title,
  });
}

export function loadSession(id: string): Session | null {
  // Try JSONL first, fallback to JSON
  const fromJsonl = readJsonl(id);
  if (fromJsonl) {
    logger.session.info("Sessão carregada (JSONL)", { sessionId: id, messageCount: fromJsonl.messages.length });
    return fromJsonl;
  }

  try {
    const raw = fs.readFileSync(sessionPath(id), "utf-8");
    const session = JSON.parse(raw) as Session;
    logger.session.info("Sessão carregada (JSON)", { sessionId: id, messageCount: session.messages.length, model: session.model });
    // Migrate to JSONL
    try { writeJsonl(session); } catch { /* ignore migration error */ }
    return session;
  } catch (err) {
    logger.session.warn("Falha ao carregar sessão", { sessionId: id, error: err instanceof Error ? err.message : String(err) });
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
    const seen = new Set<string>();
    const results: Array<{ id: string; updatedAt: string; model: string; cwd: string; messageCount: number; title?: string }> = [];

    for (const f of fs.readdirSync(dir)) {
      const isJsonl = f.endsWith(".jsonl");
      const isJson = f.endsWith(".json");
      if (!isJsonl && !isJson) continue;

      const id = f.replace(/\.(jsonl|json)$/, "");
      if (seen.has(id)) continue;

      const session = loadSession(id);
      if (!session) continue;
      seen.add(id);
      results.push({
        id: session.id,
        updatedAt: session.updatedAt,
        model: session.model,
        cwd: session.cwd,
        messageCount: session.messages.length,
        title: session.title,
      });
    }

    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  return listSessions().filter((s) => {
    const session = loadSession(s.id);
    if (!session) return false;
    return session.messages.some((m) => {
      const content = typeof m.content === "string"
        ? m.content
        : JSON.stringify(m.content);
      return content.toLowerCase().includes(q);
    });
  });
}

export function createSession(model: string): Session {
  const session: Session = {
    id: generateSessionId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    cwd: process.cwd(),
    messages: [],
  };
  logger.session.info("Sessão criada", { sessionId: session.id, model, cwd: session.cwd });
  return session;
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
    const content = fs.readFileSync(memPath, "utf-8");
    const lines = content.split("\n");
    if (lines.length > 200) {
      return lines.slice(0, 200).join("\n")
        + "\n\n[MEMORY.md truncated at 200 lines. Create separate topic files for detailed notes and link to them from MEMORY.md.]";
    }
    return content;
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
