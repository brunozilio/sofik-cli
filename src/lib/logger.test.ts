import { test, expect, describe, beforeAll, afterEach } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  logger,
  setLogSession,
  getLogDir,
  LOG_DIR,
  type LogEntry,
  type LogLevel,
  type LogCategory,
} from "./logger.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readLog(cat: string): LogEntry[] {
  const file = join(LOG_DIR, `${today()}-${cat}.log`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry);
}

function lastEntry(cat: string): LogEntry | undefined {
  const entries = readLog(cat);
  return entries[entries.length - 1];
}

// ─── LOG_DIR / getLogDir ──────────────────────────────────────────────────────

describe("LOG_DIR and getLogDir()", () => {
  test("LOG_DIR is under the user home directory", () => {
    expect(LOG_DIR).toContain(os.homedir());
    expect(LOG_DIR).toContain(".sofik-ai");
    expect(LOG_DIR).toContain("logs");
  });

  test("getLogDir() returns the same value as LOG_DIR", () => {
    expect(getLogDir()).toBe(LOG_DIR);
  });
});

// ─── setLogSession ────────────────────────────────────────────────────────────

describe("setLogSession()", () => {
  test("does not throw when called with a session ID", () => {
    expect(() => setLogSession("test-session-abc")).not.toThrow();
  });

  test("session ID appears in subsequent log entries", () => {
    const sessionId = `test-${Date.now()}`;
    setLogSession(sessionId);
    logger.app.info("session test message", { _marker: sessionId });
    const entry = lastEntry("app");
    expect(entry?.session).toBe(sessionId);
  });

  test("logger.setSession() is equivalent to setLogSession()", () => {
    const id = `session-${Date.now()}`;
    expect(() => logger.setSession(id)).not.toThrow();
    logger.app.info("after setSession", { _marker: id });
    const entry = lastEntry("app");
    expect(entry?.session).toBe(id);
  });
});

// ─── Generic shortcuts: logger.debug / info / warn / error ───────────────────

describe("generic logger shortcuts (app category)", () => {
  test("logger.debug() writes an entry with level=debug and cat=app", () => {
    const marker = `debug-${Date.now()}`;
    logger.debug(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("debug");
    expect(entry?.cat).toBe("app");
    expect(entry?.msg).toBe(marker);
  });

  test("logger.info() writes an entry with level=info and cat=app", () => {
    const marker = `info-${Date.now()}`;
    logger.info(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("info");
    expect(entry?.cat).toBe("app");
    expect(entry?.msg).toBe(marker);
  });

  test("logger.warn() writes an entry with level=warn and cat=app", () => {
    const marker = `warn-${Date.now()}`;
    logger.warn(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("warn");
    expect(entry?.cat).toBe("app");
    expect(entry?.msg).toBe(marker);
  });

  test("logger.error() writes an entry with level=error and cat=error", () => {
    const marker = `error-${Date.now()}`;
    logger.error(marker);
    const entry = lastEntry("error");
    expect(entry?.level).toBe("error");
    expect(entry?.cat).toBe("error");
    expect(entry?.msg).toBe(marker);
  });

  test("logger.debug() accepts optional data object", () => {
    expect(() => logger.debug("debug with data", { key: "value" })).not.toThrow();
  });

  test("logger.info() accepts optional data object", () => {
    expect(() => logger.info("info with data", { count: 1 })).not.toThrow();
  });
});

// ─── app category ─────────────────────────────────────────────────────────────

describe("logger.app", () => {
  test("app.info() writes to app log", () => {
    const marker = `app-info-${Date.now()}`;
    logger.app.info(marker);
    const entry = lastEntry("app");
    expect(entry?.cat).toBe("app");
    expect(entry?.level).toBe("info");
    expect(entry?.msg).toBe(marker);
  });

  test("app.warn() writes to app log", () => {
    const marker = `app-warn-${Date.now()}`;
    logger.app.warn(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("warn");
  });

  test("app.error() writes to app log", () => {
    const marker = `app-error-${Date.now()}`;
    logger.app.error(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("error");
  });

  test("app.debug() writes to app log", () => {
    const marker = `app-debug-${Date.now()}`;
    logger.app.debug(marker);
    const entry = lastEntry("app");
    expect(entry?.level).toBe("debug");
  });
});

// ─── llm category ─────────────────────────────────────────────────────────────

describe("logger.llm", () => {
  test("llm.info() writes to llm log", () => {
    const marker = `llm-info-${Date.now()}`;
    logger.llm.info(marker);
    const entry = lastEntry("llm");
    expect(entry?.cat).toBe("llm");
    expect(entry?.msg).toBe(marker);
  });

  test("llm.warn() writes to llm log", () => {
    logger.llm.warn("llm warn test");
    expect(lastEntry("llm")?.level).toBe("warn");
  });

  test("llm.debug() writes to llm log", () => {
    logger.llm.debug("llm debug test");
    expect(lastEntry("llm")?.level).toBe("debug");
  });

  test("llm.error() mirrors to error log", () => {
    const marker = `llm-error-mirror-${Date.now()}`;
    logger.llm.error(marker);
    // Should appear in llm log
    const llmEntry = lastEntry("llm");
    expect(llmEntry?.msg).toBe(marker);
    // Should also be mirrored to the error log
    const errorEntry = lastEntry("error");
    expect(errorEntry?.msg).toBe(marker);
    expect(errorEntry?.cat).toBe("llm");
    expect(errorEntry?.level).toBe("error");
  });
});

// ─── tool category ────────────────────────────────────────────────────────────

describe("logger.tool", () => {
  test("tool.info() writes to tool log", () => {
    const marker = `tool-info-${Date.now()}`;
    logger.tool.info(marker);
    expect(lastEntry("tool")?.cat).toBe("tool");
    expect(lastEntry("tool")?.msg).toBe(marker);
  });

  test("tool.warn() writes to tool log", () => {
    logger.tool.warn("tool warn test");
    expect(lastEntry("tool")?.level).toBe("warn");
  });

  test("tool.debug() writes to tool log", () => {
    logger.tool.debug("tool debug test");
    expect(lastEntry("tool")?.level).toBe("debug");
  });

  test("tool.error() mirrors to error log", () => {
    const marker = `tool-error-mirror-${Date.now()}`;
    logger.tool.error(marker);
    const errorEntry = lastEntry("error");
    expect(errorEntry?.msg).toBe(marker);
    expect(errorEntry?.cat).toBe("tool");
  });
});

// ─── permission category ──────────────────────────────────────────────────────

describe("logger.permission", () => {
  test("permission.info() writes to permission log", () => {
    const marker = `perm-info-${Date.now()}`;
    logger.permission.info(marker);
    expect(lastEntry("permission")?.cat).toBe("permission");
    expect(lastEntry("permission")?.msg).toBe(marker);
  });

  test("permission.warn() writes to permission log", () => {
    logger.permission.warn("perm warn");
    expect(lastEntry("permission")?.level).toBe("warn");
  });

  test("permission.error() mirrors to error log", () => {
    const marker = `perm-error-mirror-${Date.now()}`;
    logger.permission.error(marker);
    const errorEntry = lastEntry("error");
    expect(errorEntry?.cat).toBe("permission");
    expect(errorEntry?.msg).toBe(marker);
  });
});

// ─── session category ─────────────────────────────────────────────────────────

describe("logger.session", () => {
  test("session.info() writes to session log", () => {
    const marker = `sess-info-${Date.now()}`;
    logger.session.info(marker);
    expect(lastEntry("session")?.cat).toBe("session");
    expect(lastEntry("session")?.msg).toBe(marker);
  });

  test("session.warn() writes to session log", () => {
    logger.session.warn("session warn");
    expect(lastEntry("session")?.level).toBe("warn");
  });

  test("session.error() mirrors to error log", () => {
    const marker = `session-error-mirror-${Date.now()}`;
    logger.session.error(marker);
    const errorEntry = lastEntry("error");
    expect(errorEntry?.cat).toBe("session");
    expect(errorEntry?.msg).toBe(marker);
  });
});

// ─── db category ──────────────────────────────────────────────────────────────

describe("logger.db", () => {
  test("db.info() writes to db log", () => {
    const marker = `db-info-${Date.now()}`;
    logger.db.info(marker);
    expect(lastEntry("db")?.cat).toBe("db");
    expect(lastEntry("db")?.msg).toBe(marker);
  });

  test("db.warn() writes to db log", () => {
    logger.db.warn("db warn");
    expect(lastEntry("db")?.level).toBe("warn");
  });

  test("db.debug() writes to db log", () => {
    logger.db.debug("db debug");
    expect(lastEntry("db")?.level).toBe("debug");
  });

  test("db.error() mirrors to error log", () => {
    const marker = `db-error-${Date.now()}`;
    logger.db.error(marker);
    expect(lastEntry("error")?.cat).toBe("db");
  });
});

// ─── auth category ────────────────────────────────────────────────────────────

describe("logger.auth", () => {
  test("auth.info() writes to auth log", () => {
    const marker = `auth-info-${Date.now()}`;
    logger.auth.info(marker);
    expect(lastEntry("auth")?.cat).toBe("auth");
    expect(lastEntry("auth")?.msg).toBe(marker);
  });

  test("auth.warn() writes to auth log", () => {
    logger.auth.warn("auth warn");
    expect(lastEntry("auth")?.level).toBe("warn");
  });

  test("auth.error() mirrors to error log", () => {
    const marker = `auth-error-${Date.now()}`;
    logger.auth.error(marker);
    expect(lastEntry("error")?.cat).toBe("auth");
  });
});

// ─── job category ─────────────────────────────────────────────────────────────

describe("logger.job", () => {
  test("job.info() writes to job log", () => {
    const marker = `job-info-${Date.now()}`;
    logger.job.info(marker);
    expect(lastEntry("job")?.cat).toBe("job");
    expect(lastEntry("job")?.msg).toBe(marker);
  });

  test("job.warn() writes to job log", () => {
    logger.job.warn("job warn");
    expect(lastEntry("job")?.level).toBe("warn");
  });

  test("job.error() mirrors to error log", () => {
    const marker = `job-error-${Date.now()}`;
    logger.job.error(marker);
    expect(lastEntry("error")?.cat).toBe("job");
  });
});

// ─── mcp category ─────────────────────────────────────────────────────────────

describe("logger.mcp", () => {
  test("mcp.info() writes to mcp log", () => {
    const marker = `mcp-info-${Date.now()}`;
    logger.mcp.info(marker);
    expect(lastEntry("mcp")?.cat).toBe("mcp");
    expect(lastEntry("mcp")?.msg).toBe(marker);
  });

  test("mcp.warn() writes to mcp log", () => {
    logger.mcp.warn("mcp warn");
    expect(lastEntry("mcp")?.level).toBe("warn");
  });

  test("mcp.error() mirrors to error log", () => {
    const marker = `mcp-error-${Date.now()}`;
    logger.mcp.error(marker);
    expect(lastEntry("error")?.cat).toBe("mcp");
  });
});

// ─── Log entry structure ──────────────────────────────────────────────────────

describe("log entry structure", () => {
  test("entries include ts, level, cat, msg fields", () => {
    logger.app.info("structure test");
    const entry = lastEntry("app")!;
    expect(typeof entry.ts).toBe("string");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.level).toBe("info");
    expect(entry.cat).toBe("app");
    expect(entry.msg).toBe("structure test");
  });

  test("entries include data field when non-empty data is passed", () => {
    logger.app.info("with data", { foo: "bar", num: 99 });
    const entry = lastEntry("app")!;
    expect(entry.data?.["foo"]).toBe("bar");
    expect(entry.data?.["num"]).toBe(99);
  });

  test("entries omit data field when empty object is passed", () => {
    logger.app.info("no data", {});
    const entry = lastEntry("app")!;
    expect(entry.data).toBeUndefined();
  });

  test("entries omit data field when no data is passed", () => {
    logger.app.info("no data at all");
    const entry = lastEntry("app")!;
    expect(entry.data).toBeUndefined();
  });
});

// ─── Error mirroring ──────────────────────────────────────────────────────────

describe("error mirroring — non-error categories at error level", () => {
  test("app.error() entry appears in both app and error logs", () => {
    const marker = `app-error-both-${Date.now()}`;
    logger.app.error(marker);
    const appEntry = lastEntry("app");
    const errorEntry = lastEntry("error");
    expect(appEntry?.msg).toBe(marker);
    expect(errorEntry?.msg).toBe(marker);
    // The mirrored entry has cat=app (original category) and level=error
    expect(errorEntry?.cat).toBe("app");
    expect(errorEntry?.level).toBe("error");
  });

  test("logger.error() does NOT double-write to error log (cat=error skips mirror)", () => {
    // logger.error writes with cat="error" so the mirror condition `cat !== "error"` is false
    const markerBefore = `before-${Date.now()}`;
    logger.app.info(markerBefore);
    const countBefore = readLog("error").length;
    logger.error("direct error log call");
    const countAfter = readLog("error").length;
    // Only one new entry — no extra mirror
    expect(countAfter).toBe(countBefore + 1);
  });
});
