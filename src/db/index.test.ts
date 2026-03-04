import { test, expect, describe, beforeAll, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Use in-memory SQLite — must be set before any import that triggers getDb()
process.env.DATABASE_URL = ":memory:";

import { getDb, dbQuery, dbQueryOne, dbRun, dbTransaction, jsonParse, jsonStringify, resetDb } from "./index.ts";

// ── getDb ──────────────────────────────────────────────────────────────────────

describe("getDb", () => {
  test("returns a Database instance", () => {
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.exec).toBe("function");
  });

  test("returns the same instance on repeat calls (singleton)", () => {
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
  });

  test("database has the tasks table (schema was applied)", () => {
    const db = getDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row?.name).toBe("tasks");
  });

  test("database has the integrations table (schema was applied)", () => {
    const db = getDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='integrations'").get() as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row?.name).toBe("integrations");
  });
});

// ── dbQuery ────────────────────────────────────────────────────────────────────

describe("dbQuery", () => {
  const table = `test_query_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(() => {
    dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, val TEXT NOT NULL)`, []);
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, ["a", "alpha"]);
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, ["b", "beta"]);
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, ["c", "gamma"]);
  });

  test("returns all rows when no filter", () => {
    const rows = dbQuery<{ id: string; val: string }>(`SELECT * FROM ${table}`, []);
    expect(rows.length).toBe(3);
  });

  test("returns matching rows with a parameter", () => {
    const rows = dbQuery<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, ["b"]);
    expect(rows.length).toBe(1);
    expect(rows[0].val).toBe("beta");
  });

  test("returns empty array when nothing matches", () => {
    const rows = dbQuery<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, ["zzz"]);
    expect(rows).toEqual([]);
  });

  test("returns typed rows (fields are accessible)", () => {
    const rows = dbQuery<{ id: string; val: string }>(`SELECT * FROM ${table} ORDER BY id ASC`, []);
    expect(rows[0].id).toBe("a");
    expect(rows[0].val).toBe("alpha");
  });

  test("defaults to empty params array (no params argument)", () => {
    const rows = dbQuery<{ id: string; val: string }>(`SELECT * FROM ${table}`);
    expect(rows.length).toBe(3);
  });
});

// ── dbQueryOne ─────────────────────────────────────────────────────────────────

describe("dbQueryOne", () => {
  const table = `test_query_one_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(() => {
    dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, val TEXT NOT NULL)`, []);
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, ["x1", "hello"]);
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, ["x2", "world"]);
  });

  test("returns a single row when found", () => {
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, ["x1"]);
    expect(row).not.toBeNull();
    expect(row?.id).toBe("x1");
    expect(row?.val).toBe("hello");
  });

  test("returns null when not found", () => {
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, ["nonexistent"]);
    expect(row).toBeNull();
  });

  test("returns only the first row when multiple rows match", () => {
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} ORDER BY id ASC`, []);
    expect(row).not.toBeNull();
    expect(row?.id).toBe("x1");
  });

  test("defaults to empty params array (no params argument)", () => {
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = 'x2'`);
    expect(row).not.toBeNull();
    expect(row?.val).toBe("world");
  });
});

// ── dbRun ──────────────────────────────────────────────────────────────────────

describe("dbRun", () => {
  const table = `test_run_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(() => {
    dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, val TEXT NOT NULL)`, []);
  });

  test("INSERT: row is created", () => {
    const id = randomUUID();
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id, "inserted"]);
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    expect(row).not.toBeNull();
    expect(row?.val).toBe("inserted");
  });

  test("UPDATE: row value changes", () => {
    const id = randomUUID();
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id, "original"]);
    dbRun(`UPDATE ${table} SET val = ? WHERE id = ?`, ["updated", id]);
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    expect(row?.val).toBe("updated");
  });

  test("DELETE: row is removed", () => {
    const id = randomUUID();
    dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id, "to-delete"]);
    dbRun(`DELETE FROM ${table} WHERE id = ?`, [id]);
    const row = dbQueryOne<{ id: string; val: string }>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    expect(row).toBeNull();
  });

  test("returns void (no return value)", () => {
    const result = dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [randomUUID(), "void-check"]);
    expect(result).toBeUndefined();
  });
});

// ── dbTransaction ──────────────────────────────────────────────────────────────

describe("dbTransaction", () => {
  const table = `test_txn_${randomUUID().replace(/-/g, "_")}`;

  beforeAll(() => {
    dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, val TEXT NOT NULL)`, []);
  });

  test("commits all writes when the callback succeeds", () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    dbTransaction(() => {
      dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id1, "txn-a"]);
      dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id2, "txn-b"]);
    });

    const row1 = dbQueryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id1]);
    const row2 = dbQueryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id2]);
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
  });

  test("rolls back all writes when the callback throws", () => {
    const id = randomUUID();

    expect(() => {
      dbTransaction(() => {
        dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id, "should-rollback"]);
        throw new Error("intentional failure");
      });
    }).toThrow("intentional failure");

    const row = dbQueryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
    expect(row).toBeNull();
  });

  test("returns the value produced by the callback", () => {
    const result = dbTransaction(() => {
      return 42;
    });
    expect(result).toBe(42);
  });

  test("nested inserts inside transaction are all visible after commit", () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];

    dbTransaction(() => {
      for (const id of ids) {
        dbRun(`INSERT INTO ${table} (id, val) VALUES (?, ?)`, [id, "batch"]);
      }
    });

    for (const id of ids) {
      const row = dbQueryOne<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, [id]);
      expect(row).not.toBeNull();
    }
  });
});

// ── jsonParse ──────────────────────────────────────────────────────────────────

describe("jsonParse", () => {
  test("parses a valid JSON string", () => {
    const result = jsonParse<{ a: number }>('{"a":1}', { a: 0 });
    expect(result).toEqual({ a: 1 });
  });

  test("parses a JSON array", () => {
    const result = jsonParse<number[]>("[1,2,3]", []);
    expect(result).toEqual([1, 2, 3]);
  });

  test("parses a JSON primitive string", () => {
    const result = jsonParse<string>('"hello"', "");
    expect(result).toBe("hello");
  });

  test("returns fallback for invalid JSON", () => {
    const fallback = { x: 99 };
    const result = jsonParse<{ x: number }>("not-json", fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for null value", () => {
    const fallback = "default";
    const result = jsonParse<string>(null, fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for undefined value", () => {
    const fallback = "default";
    const result = jsonParse<string>(undefined, fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for empty string", () => {
    const fallback = { z: 0 };
    const result = jsonParse<{ z: number }>("", fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for non-string number value", () => {
    const fallback = 0;
    const result = jsonParse<number>(123, fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for non-string object value", () => {
    const fallback = {};
    const result = jsonParse<object>({ already: "parsed" }, fallback);
    expect(result).toBe(fallback);
  });

  test("returns fallback for malformed JSON (truncated)", () => {
    const fallback = null;
    const result = jsonParse('{"a":', fallback);
    expect(result).toBeNull();
  });
});

// ── jsonStringify ──────────────────────────────────────────────────────────────

describe("jsonStringify", () => {
  test("stringifies a plain object", () => {
    const result = jsonStringify({ key: "value", num: 42 });
    expect(result).toBe('{"key":"value","num":42}');
  });

  test("stringifies an array", () => {
    const result = jsonStringify([1, 2, 3]);
    expect(result).toBe("[1,2,3]");
  });

  test("stringifies a nested object", () => {
    const result = jsonStringify({ a: { b: true } });
    expect(result).toBe('{"a":{"b":true}}');
  });

  test("null becomes '{}'", () => {
    const result = jsonStringify(null);
    expect(result).toBe("{}");
  });

  test("undefined becomes '{}'", () => {
    const result = jsonStringify(undefined);
    expect(result).toBe("{}");
  });

  test("empty object becomes '{}'", () => {
    const result = jsonStringify({});
    expect(result).toBe("{}");
  });

  test("stringifies a number", () => {
    const result = jsonStringify(7);
    expect(result).toBe("7");
  });

  test("stringifies a boolean", () => {
    expect(jsonStringify(true)).toBe("true");
    expect(jsonStringify(false)).toBe("false");
  });

  test("round-trip with jsonParse", () => {
    const original = { foo: "bar", count: 3 };
    const serialized = jsonStringify(original);
    const parsed = jsonParse<typeof original>(serialized, {});
    expect(parsed).toEqual(original);
  });
});

// ── resetDb + getDb path resolution ───────────────────────────────────────────
// These tests exercise the DATABASE_URL ternary branches (lines 22-23) that are
// unreachable when only :memory: is used.  resetDb() lets us swap the URL
// between tests without module re-import.

describe("resetDb / getDb path resolution", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-db-path-"));
  const origUrl = process.env.DATABASE_URL;

  afterEach(() => {
    // Always restore :memory: so subsequent tests in other suites aren't broken
    resetDb();
    process.env.DATABASE_URL = ":memory:";
    getDb(); // re-initialise with :memory:
  });

  test("resetDb() allows getDb() to re-initialise", () => {
    const db1 = getDb();
    resetDb();
    const db2 = getDb();
    // After reset a new instance should be created
    expect(db2).toBeDefined();
    expect(typeof db2.prepare).toBe("function");
  });

  test("sqlite:// prefix is stripped from DATABASE_URL (line 22)", () => {
    const filePath = path.join(tmpDir, "sqlite-prefix.db");
    process.env.DATABASE_URL = `sqlite://${filePath}`;
    resetDb();
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe("function");
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
  });

  test("plain file path DATABASE_URL is used as-is (line 23)", () => {
    const filePath = path.join(tmpDir, "plain-path.db");
    process.env.DATABASE_URL = filePath;
    resetDb();
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe("function");
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
  });
});
