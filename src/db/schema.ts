// ── Database Schema (SQL DDL) ──────────────────────────────────────────────────
// Simplified single-user CLI schema (no auth/tenants/queue/marketplace)

export const SCHEMA_SQL = `
-- Integrations
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  credentials_encrypted TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task Queue
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  position INTEGER NOT NULL DEFAULT 0,
  worktree_path TEXT,
  worktree_branch TEXT,
  plan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, position, created_at);
`;
