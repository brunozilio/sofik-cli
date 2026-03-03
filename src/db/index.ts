/**
 * Database abstraction layer for the CLI.
 * Uses bun:sqlite backed by ~/.sofik/sofik.db
 */
import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./schema.ts";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger.ts";

export { randomUUID };

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const dbPath = process.env.DATABASE_URL ?? path.join(os.homedir(), ".sofik", "sofik.db");
    const filePath = dbPath === ":memory:"
      ? ":memory:"
      : dbPath.startsWith("sqlite://")
      ? dbPath.slice("sqlite://".length)
      : dbPath;

    // Ensure directory exists
    if (filePath !== ":memory:") {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    _db = new Database(filePath, { create: true });
    _db.exec("PRAGMA journal_mode = WAL;");
    _db.exec("PRAGMA foreign_keys = ON;");
    _db.exec(SCHEMA_SQL);
    logger.db.info("Banco de dados inicializado", { path: filePath });

    // Migrations: add columns that may not exist in older DBs
    for (const migration of [
      "ALTER TABLE tasks ADD COLUMN worktree_path TEXT",
      "ALTER TABLE tasks ADD COLUMN worktree_branch TEXT",
      "ALTER TABLE tasks ADD COLUMN plan TEXT",
    ]) {
      try { _db.exec(migration); } catch { /* column already exists */ }
    }
  }
  return _db;
}

// ── Generic query helpers ──────────────────────────────────────────────────────

export function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = stmt.all(...(params as any[])) as T[];
  logger.db.debug("dbQuery", { sql: sql.slice(0, 120), paramCount: params.length, rowCount: rows.length });
  return rows;
}

export function dbQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T | null {
  const db = getDb();
  const stmt = db.prepare(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (stmt.get(...(params as any[])) as T) ?? null;
  logger.db.debug("dbQueryOne", { sql: sql.slice(0, 120), paramCount: params.length, found: row !== null });
  return row;
}

export function dbRun(sql: string, params: unknown[] = []): void {
  const db = getDb();
  const stmt = db.prepare(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stmt.run(...(params as any[]));
  logger.db.debug("dbRun", { sql: sql.slice(0, 120), paramCount: params.length });
}

export function dbTransaction<T>(fn: () => T): T {
  const db = getDb();
  logger.db.debug("dbTransaction: iniciada");
  const result = db.transaction(fn)();
  logger.db.debug("dbTransaction: concluída");
  return result;
}

// ── JSON helpers (SQLite stores JSON as TEXT) ──────────────────────────────────

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? {});
}
