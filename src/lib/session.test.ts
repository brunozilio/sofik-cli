import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { createHash } from "crypto";

import {
  generateSessionId,
  createSession,
  saveSession,
  loadSession,
  listSessions,
  searchSessions,
  projectHash,
  getProjectMemoryDir,
  loadProjectMemory,
  ensureProjectMemoryPath,
} from "./session.ts";
import type { Session } from "./session.ts";

// ─── Setup: track session IDs created so we can clean up ─────────────────────

const createdSessionIds: string[] = [];
const SESSIONS_DIR = path.join(os.homedir(), ".sofik", "sessions");

// Project memory dirs created during tests (for cleanup)
const createdMemoryDirs: string[] = [];

afterAll(() => {
  // Remove all session files created during tests
  for (const id of createdSessionIds) {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  // Remove project memory dirs
  for (const dir of createdMemoryDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeSession(model = "claude-opus-4-6"): Session {
  const session = createSession(model);
  createdSessionIds.push(session.id);
  return session;
}

// ─── generateSessionId ────────────────────────────────────────────────────────

describe("generateSessionId", () => {
  test("returns a string", () => {
    expect(typeof generateSessionId()).toBe("string");
  });

  test("starts with 'session-'", () => {
    expect(generateSessionId()).toMatch(/^session-/);
  });

  test("returns unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));
    expect(ids.size).toBe(20);
  });

  test("format matches session-<timestamp>-<random>", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^session-\d+-[a-z0-9]+$/);
  });
});

// ─── createSession ────────────────────────────────────────────────────────────

describe("createSession", () => {
  test("returns session with the specified model", () => {
    const session = makeSession("claude-opus-4-6");
    expect(session.model).toBe("claude-opus-4-6");
  });

  test("id starts with 'session-'", () => {
    const session = makeSession();
    expect(session.id).toMatch(/^session-/);
  });

  test("messages is an empty array", () => {
    const session = makeSession();
    expect(session.messages).toEqual([]);
  });

  test("createdAt is an ISO date string", () => {
    const session = makeSession();
    expect(() => new Date(session.createdAt).toISOString()).not.toThrow();
    expect(session.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("updatedAt is an ISO date string", () => {
    const session = makeSession();
    expect(() => new Date(session.updatedAt).toISOString()).not.toThrow();
    expect(session.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("cwd matches process.cwd()", () => {
    const session = makeSession();
    expect(session.cwd).toBe(process.cwd());
  });

  test("title is undefined by default", () => {
    const session = makeSession();
    expect(session.title).toBeUndefined();
  });

  test("different sessions get different IDs", () => {
    const s1 = makeSession();
    const s2 = makeSession();
    expect(s1.id).not.toBe(s2.id);
  });

  test("different models are preserved", () => {
    const s = makeSession("gpt-4o");
    expect(s.model).toBe("gpt-4o");
  });
});

// ─── saveSession / loadSession ────────────────────────────────────────────────

describe("saveSession and loadSession", () => {
  test("saved session can be loaded back with same data", () => {
    const session = makeSession("test-model");
    session.messages = [{ role: "user", content: "hello" }];
    saveSession(session);
    const loaded = loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.model).toBe("test-model");
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0]!.content).toBe("hello");
  });

  test("loadSession on nonexistent ID returns null", () => {
    const result = loadSession("session-nonexistent-abc123xyz");
    expect(result).toBeNull();
  });

  test("saveSession updates updatedAt timestamp", async () => {
    const session = makeSession();
    const originalUpdatedAt = session.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));
    saveSession(session);
    expect(session.updatedAt).not.toBe(originalUpdatedAt);
    expect(new Date(session.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime()
    );
  });

  test("saved session data round-trips correctly (cwd, messages)", () => {
    const session = makeSession("model-x");
    session.messages = [
      { role: "user", content: "prompt" },
      { role: "assistant", content: [{ type: "text", text: "response" }] },
    ];
    saveSession(session);
    const loaded = loadSession(session.id);
    expect(loaded!.cwd).toBe(session.cwd);
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[1]!.content).toEqual([{ type: "text", text: "response" }]);
  });

  test("session with title round-trips correctly", () => {
    const session = makeSession();
    session.title = "My Test Session";
    saveSession(session);
    const loaded = loadSession(session.id);
    expect(loaded!.title).toBe("My Test Session");
  });

  test("overwriting a session with new content", () => {
    const session = makeSession();
    session.messages = [{ role: "user", content: "first" }];
    saveSession(session);

    session.messages.push({ role: "assistant", content: "second" });
    saveSession(session);

    const loaded = loadSession(session.id);
    expect(loaded!.messages).toHaveLength(2);
  });
});

// ─── listSessions ─────────────────────────────────────────────────────────────

describe("listSessions", () => {
  test("returns an array", () => {
    expect(Array.isArray(listSessions())).toBe(true);
  });

  test("includes saved sessions", () => {
    const session = makeSession("list-model");
    saveSession(session);
    const sessions = listSessions();
    const found = sessions.find((s) => s.id === session.id);
    expect(found).toBeDefined();
  });

  test("each entry has expected shape", () => {
    const session = makeSession("shape-model");
    saveSession(session);
    const sessions = listSessions();
    const found = sessions.find((s) => s.id === session.id);
    expect(found).toMatchObject({
      id: expect.any(String),
      updatedAt: expect.any(String),
      model: expect.any(String),
      cwd: expect.any(String),
      messageCount: expect.any(Number),
    });
  });

  test("messageCount reflects actual messages", () => {
    const session = makeSession();
    session.messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    saveSession(session);
    const sessions = listSessions();
    const found = sessions.find((s) => s.id === session.id);
    expect(found!.messageCount).toBe(3);
  });

  test("handles corrupted JSON files gracefully (skips them)", () => {
    // Write a corrupt file
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const corruptId = `session-corrupt-${Date.now()}`;
    const corruptPath = path.join(SESSIONS_DIR, `${corruptId}.json`);
    fs.writeFileSync(corruptPath, "{ invalid json !!!", "utf-8");
    createdSessionIds.push(corruptId);

    // Should not throw and should still return other sessions
    expect(() => listSessions()).not.toThrow();
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    // Corrupt file should not appear
    expect(sessions.find((s) => s.id === corruptId)).toBeUndefined();
  });

  test("sessions sorted by updatedAt descending", async () => {
    const s1 = makeSession("model-1");
    saveSession(s1);
    await new Promise((r) => setTimeout(r, 15));
    const s2 = makeSession("model-2");
    saveSession(s2);

    const sessions = listSessions();
    const idx1 = sessions.findIndex((s) => s.id === s1.id);
    const idx2 = sessions.findIndex((s) => s.id === s2.id);
    // s2 was saved later → should appear before s1
    expect(idx2).toBeLessThan(idx1);
  });
});

// ─── searchSessions ───────────────────────────────────────────────────────────

describe("searchSessions", () => {
  test("returns array", () => {
    expect(Array.isArray(searchSessions("anything"))).toBe(true);
  });

  test("finds session by string message content", () => {
    const session = makeSession();
    const unique = `uniqueterm-${Date.now()}`;
    session.messages = [{ role: "user", content: `hello ${unique} world` }];
    saveSession(session);

    const results = searchSessions(unique);
    expect(results.find((s) => s.id === session.id)).toBeDefined();
  });

  test("search is case-insensitive", () => {
    const session = makeSession();
    const unique = `CaseSearch-${Date.now()}`;
    session.messages = [{ role: "user", content: `hello ${unique}` }];
    saveSession(session);

    const results = searchSessions(unique.toLowerCase());
    expect(results.find((s) => s.id === session.id)).toBeDefined();
  });

  test("returns empty array when no match", () => {
    const session = makeSession();
    session.messages = [{ role: "user", content: "unrelated content here" }];
    saveSession(session);

    const results = searchSessions("xyzzy-no-match-ever-12345");
    expect(results.find((s) => s.id === session.id)).toBeUndefined();
  });

  test("searches array message content (JSON.stringify)", () => {
    const session = makeSession();
    const unique = `arraymsg-${Date.now()}`;
    session.messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: `result contains ${unique}` }],
      },
    ];
    saveSession(session);

    const results = searchSessions(unique);
    expect(results.find((s) => s.id === session.id)).toBeDefined();
  });

  test("does not return sessions without matching content", () => {
    const s1 = makeSession();
    s1.messages = [{ role: "user", content: "tomato sauce pasta" }];
    saveSession(s1);

    const s2 = makeSession();
    s2.messages = [{ role: "user", content: "bicycle repair guide" }];
    saveSession(s2);

    const unique = `tomato-${s1.id}`;
    // Rewrite s1 with unique term
    s1.messages = [{ role: "user", content: `find me: ${unique}` }];
    saveSession(s1);

    const results = searchSessions(unique);
    expect(results.find((r) => r.id === s1.id)).toBeDefined();
    expect(results.find((r) => r.id === s2.id)).toBeUndefined();
  });

  test("results sorted by updatedAt descending", async () => {
    const unique = `sorttest-${Date.now()}`;

    const s1 = makeSession();
    s1.messages = [{ role: "user", content: `${unique} first` }];
    saveSession(s1);

    await new Promise((r) => setTimeout(r, 15));

    const s2 = makeSession();
    s2.messages = [{ role: "user", content: `${unique} second` }];
    saveSession(s2);

    const results = searchSessions(unique);
    const idx1 = results.findIndex((r) => r.id === s1.id);
    const idx2 = results.findIndex((r) => r.id === s2.id);
    expect(idx2).toBeLessThan(idx1);
  });
});

// ─── projectHash ─────────────────────────────────────────────────────────────

describe("projectHash", () => {
  test("returns a string", () => {
    expect(typeof projectHash("/some/path")).toBe("string");
  });

  test("returns exactly 16 hex characters", () => {
    const hash = projectHash("/some/path");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test("is deterministic: same input always gives same output", () => {
    const path1 = "/Users/test/project";
    expect(projectHash(path1)).toBe(projectHash(path1));
  });

  test("different paths give different hashes", () => {
    const h1 = projectHash("/project/alpha");
    const h2 = projectHash("/project/beta");
    expect(h1).not.toBe(h2);
  });

  test("matches expected SHA-256 prefix", () => {
    const cwd = "/some/test/path";
    const expected = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
    expect(projectHash(cwd)).toBe(expected);
  });

  test("empty string path produces consistent hash", () => {
    const h1 = projectHash("");
    const h2 = projectHash("");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
  });
});

// ─── getProjectMemoryDir ──────────────────────────────────────────────────────

describe("getProjectMemoryDir", () => {
  test("returns a string path", () => {
    expect(typeof getProjectMemoryDir()).toBe("string");
  });

  test("path is under ~/.sofik/projects/", () => {
    const dir = getProjectMemoryDir();
    expect(dir).toContain(path.join(os.homedir(), ".sofik", "projects"));
  });

  test("path ends with /memory", () => {
    const dir = getProjectMemoryDir();
    expect(dir.endsWith(path.sep + "memory")).toBe(true);
  });

  test("uses provided cwd argument", () => {
    const dir1 = getProjectMemoryDir("/project/one");
    const dir2 = getProjectMemoryDir("/project/two");
    expect(dir1).not.toBe(dir2);
  });

  test("includes the hash of the cwd", () => {
    const cwd = "/my/test/project";
    const hash = projectHash(cwd);
    const dir = getProjectMemoryDir(cwd);
    expect(dir).toContain(hash);
  });
});

// ─── loadProjectMemory ────────────────────────────────────────────────────────

describe("loadProjectMemory", () => {
  test("returns null when no memory file exists", () => {
    // Use a unique fake path that won't have a memory file
    const fakeCwd = path.join(os.tmpdir(), `fakecwd-${Date.now()}`);
    const result = loadProjectMemory(fakeCwd);
    expect(result).toBeNull();
  });

  test("returns content when MEMORY.md exists", () => {
    const fakeCwd = path.join(os.tmpdir(), `memcwd-${Date.now()}`);
    const memDir = getProjectMemoryDir(fakeCwd);
    fs.mkdirSync(memDir, { recursive: true });
    createdMemoryDirs.push(memDir);
    const memFile = path.join(memDir, "MEMORY.md");
    fs.writeFileSync(memFile, "# Project Memory\n\nSome context.", "utf-8");

    const result = loadProjectMemory(fakeCwd);
    expect(result).toBe("# Project Memory\n\nSome context.");
  });

  test("returns null for empty path that doesn't exist", () => {
    const result = loadProjectMemory("/nonexistent/path/xyz/abc");
    expect(result).toBeNull();
  });
});

// ─── ensureProjectMemoryPath ──────────────────────────────────────────────────

describe("ensureProjectMemoryPath", () => {
  test("returns a string path", () => {
    const fakeCwd = path.join(os.tmpdir(), `ensure-${Date.now()}`);
    const result = ensureProjectMemoryPath(fakeCwd);
    const memDir = getProjectMemoryDir(fakeCwd);
    createdMemoryDirs.push(memDir);
    expect(typeof result).toBe("string");
  });

  test("returned path ends with MEMORY.md", () => {
    const fakeCwd = path.join(os.tmpdir(), `ensure2-${Date.now()}`);
    const result = ensureProjectMemoryPath(fakeCwd);
    const memDir = getProjectMemoryDir(fakeCwd);
    createdMemoryDirs.push(memDir);
    expect(result.endsWith("MEMORY.md")).toBe(true);
  });

  test("creates the directory if it does not exist", () => {
    const fakeCwd = path.join(os.tmpdir(), `ensure3-${Date.now()}`);
    const memDir = getProjectMemoryDir(fakeCwd);
    createdMemoryDirs.push(memDir);
    // Directory should not exist yet
    expect(fs.existsSync(memDir)).toBe(false);
    ensureProjectMemoryPath(fakeCwd);
    expect(fs.existsSync(memDir)).toBe(true);
  });

  test("returned path is writable", () => {
    const fakeCwd = path.join(os.tmpdir(), `ensure4-${Date.now()}`);
    const memPath = ensureProjectMemoryPath(fakeCwd);
    const memDir = getProjectMemoryDir(fakeCwd);
    createdMemoryDirs.push(memDir);
    expect(() => fs.writeFileSync(memPath, "test content", "utf-8")).not.toThrow();
    expect(fs.readFileSync(memPath, "utf-8")).toBe("test content");
  });

  test("calling twice does not throw (directory already exists)", () => {
    const fakeCwd = path.join(os.tmpdir(), `ensure5-${Date.now()}`);
    const memDir = getProjectMemoryDir(fakeCwd);
    createdMemoryDirs.push(memDir);
    ensureProjectMemoryPath(fakeCwd);
    expect(() => ensureProjectMemoryPath(fakeCwd)).not.toThrow();
  });
});
