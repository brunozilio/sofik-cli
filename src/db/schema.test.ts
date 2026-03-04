import { test, expect, describe } from "bun:test";
import { SCHEMA_SQL } from "./schema.ts";

describe("SCHEMA_SQL", () => {
  test("is a non-empty string", () => {
    expect(typeof SCHEMA_SQL).toBe("string");
    expect(SCHEMA_SQL.length).toBeGreaterThan(0);
  });

  test("contains integrations table definition", () => {
    expect(SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS integrations");
  });

  test("contains tasks table definition", () => {
    expect(SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS tasks");
  });

  test("integrations table has id column", () => {
    expect(SCHEMA_SQL).toContain("id TEXT PRIMARY KEY");
  });

  test("integrations table has provider column (UNIQUE)", () => {
    expect(SCHEMA_SQL).toContain("provider TEXT NOT NULL UNIQUE");
  });

  test("integrations table has name column", () => {
    expect(SCHEMA_SQL).toContain("name TEXT NOT NULL");
  });

  test("integrations table has credentials_encrypted column", () => {
    expect(SCHEMA_SQL).toContain("credentials_encrypted TEXT NOT NULL");
  });

  test("integrations table has status column with default 'active'", () => {
    expect(SCHEMA_SQL).toContain("status TEXT NOT NULL DEFAULT 'active'");
  });

  test("integrations table has created_at column", () => {
    expect(SCHEMA_SQL).toContain("created_at TEXT NOT NULL");
  });

  test("integrations table has updated_at column", () => {
    expect(SCHEMA_SQL).toContain("updated_at TEXT NOT NULL");
  });

  test("tasks table has id column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("id TEXT PRIMARY KEY");
  });

  test("tasks table has context column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("context TEXT NOT NULL");
  });

  test("tasks table has status column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("status TEXT NOT NULL DEFAULT 'pending'");
  });

  test("tasks table has position column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("position INTEGER NOT NULL DEFAULT 0");
  });

  test("tasks table has worktree_path column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("worktree_path TEXT");
  });

  test("tasks table has worktree_branch column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("worktree_branch TEXT");
  });

  test("tasks table has plan column", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("plan TEXT");
  });

  test("tasks table has created_at and updated_at columns", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("created_at TEXT NOT NULL");
    expect(tasksSection).toContain("updated_at TEXT NOT NULL");
  });

  test("tasks table has started_at and completed_at columns (nullable)", () => {
    const tasksSection = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf("CREATE TABLE IF NOT EXISTS tasks"));
    expect(tasksSection).toContain("started_at TEXT");
    expect(tasksSection).toContain("completed_at TEXT");
  });

  test("includes an index on tasks table", () => {
    expect(SCHEMA_SQL).toContain("CREATE INDEX IF NOT EXISTS");
    expect(SCHEMA_SQL).toContain("idx_tasks_queue");
  });

  test("tasks index covers status, position, created_at", () => {
    expect(SCHEMA_SQL).toContain("status, position, created_at");
  });

  test("uses IF NOT EXISTS for idempotent creation", () => {
    // Both tables use IF NOT EXISTS
    const createCount = (SCHEMA_SQL.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
    expect(createCount).toBe(2);
  });
});
