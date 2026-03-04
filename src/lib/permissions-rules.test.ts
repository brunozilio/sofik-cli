/**
 * permissions-rules.test.ts
 *
 * Tests for rule evaluation (specifierMatches / evaluateRules) and
 * acceptEdits mode. Uses a temp directory for settings isolation so there
 * are no race conditions with settings.test.ts and no mock.module bleed.
 */
import { test, expect, describe, beforeEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Temp dir isolation ───────────────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "sofik-perm-rules-"));
const ORIG_CWD = process.cwd();

import { invalidateSettingsCache } from "./settings.ts";
import {
  setPermissionMode,
  checkPermission,
  detectDangerousCommand,
  approve,
} from "./permissions.ts";

beforeAll(() => {
  mkdirSync(join(TEST_DIR, ".sofik"), { recursive: true });
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), "{}", "utf-8");
  process.chdir(TEST_DIR);
  invalidateSettingsCache();
});

afterAll(() => {
  process.chdir(ORIG_CWD);
  invalidateSettingsCache();
  rmSync(TEST_DIR, { recursive: true });
});

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  setPermissionMode("ask");
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), "{}", "utf-8");
  invalidateSettingsCache();
});

// ─── Helper: inject rules ─────────────────────────────────────────────────────

function withRules(rules: Array<{ type: "allow" | "deny" | "ask"; rule: string }>) {
  writeFileSync(
    join(TEST_DIR, ".sofik", "settings.json"),
    JSON.stringify({ permissions: rules }),
    "utf-8",
  );
  invalidateSettingsCache();
}

// ─── acceptEdits mode ─────────────────────────────────────────────────────────

describe("acceptEdits mode", () => {
  beforeEach(() => {
    setPermissionMode("acceptEdits");
  });

  test("Edit returns 'allow' in acceptEdits mode", () => {
    expect(checkPermission("Edit", { file_path: "/tmp/test.ts" })).toBe("allow");
  });

  test("Write returns 'allow' in acceptEdits mode", () => {
    expect(checkPermission("Write", { file_path: "/tmp/test.txt" })).toBe("allow");
  });

  test("MultiEdit returns 'allow' in acceptEdits mode", () => {
    expect(checkPermission("MultiEdit", { file_path: "/tmp/test.ts" })).toBe("allow");
  });

  test("NotebookEdit returns 'allow' in acceptEdits mode", () => {
    expect(checkPermission("NotebookEdit", { notebook_path: "/tmp/nb.ipynb" })).toBe("allow");
  });

  test("Bash returns 'ask' in acceptEdits mode (dangerous non-edit)", () => {
    expect(checkPermission("Bash", { command: "ls" })).toBe("ask");
  });

  test("Read returns 'allow' in acceptEdits mode (non-dangerous)", () => {
    expect(checkPermission("Read", { file_path: "/tmp/test.txt" })).toBe("allow");
  });

  test("Glob returns 'allow' in acceptEdits mode (non-dangerous)", () => {
    expect(checkPermission("Glob", { pattern: "**/*.ts" })).toBe("allow");
  });

  test("Grep returns 'allow' in acceptEdits mode (non-dangerous)", () => {
    expect(checkPermission("Grep", { pattern: "foo" })).toBe("allow");
  });

  test("WebFetch returns 'allow' in acceptEdits mode (non-dangerous)", () => {
    expect(checkPermission("WebFetch", { url: "https://example.com" })).toBe("allow");
  });
});

// ─── Rule evaluation — Bash tool ─────────────────────────────────────────────

describe("settings rules — Bash tool", () => {
  test("'allow' rule for Bash allows any bash command", () => {
    withRules([{ type: "allow", rule: "Bash" }]);
    expect(checkPermission("Bash", { command: "rm -rf /tmp/test" })).toBe("allow");
  });

  test("'deny' rule for Bash denies any bash command", () => {
    withRules([{ type: "deny", rule: "Bash" }]);
    expect(checkPermission("Bash", { command: "ls" })).toBe("deny");
  });

  test("'ask' rule for Bash returns 'ask'", () => {
    withRules([{ type: "ask", rule: "Bash" }]);
    expect(checkPermission("Bash", { command: "echo hi" })).toBe("ask");
  });

  test("rule for different tool does not match Bash", () => {
    withRules([{ type: "allow", rule: "Read" }]);
    // No matching rule → falls through to default ask-mode
    expect(checkPermission("Bash", { command: "ls" })).toBe("ask");
  });
});

// ─── Rule evaluation — Bash(prefix:*) colon specifier ────────────────────────

describe("settings rules — Bash colon specifier", () => {
  test("Bash(git:*) matches 'git status'", () => {
    withRules([{ type: "allow", rule: "Bash(git:*)" }]);
    expect(checkPermission("Bash", { command: "git status" })).toBe("allow");
  });

  test("Bash(git:*) matches 'git commit -m hello'", () => {
    withRules([{ type: "allow", rule: "Bash(git:*)" }]);
    expect(checkPermission("Bash", { command: "git commit -m hello" })).toBe("allow");
  });

  test("Bash(git:*) does NOT match 'npm install'", () => {
    withRules([{ type: "allow", rule: "Bash(git:*)" }]);
    expect(checkPermission("Bash", { command: "npm install" })).toBe("ask");
  });

  test("Bash(git:*) matches bare 'git' command (no args)", () => {
    withRules([{ type: "allow", rule: "Bash(git:*)" }]);
    expect(checkPermission("Bash", { command: "git" })).toBe("allow");
  });

  test("Bash(npm:install) matches 'npm install' exactly", () => {
    withRules([{ type: "allow", rule: "Bash(npm:install)" }]);
    expect(checkPermission("Bash", { command: "npm install" })).toBe("allow");
  });

  test("Bash(npm:install) does NOT match 'npm run dev'", () => {
    withRules([{ type: "allow", rule: "Bash(npm:install)" }]);
    expect(checkPermission("Bash", { command: "npm run dev" })).toBe("ask");
  });

  test("deny Bash(rm:*) denies 'rm -rf /tmp'", () => {
    withRules([{ type: "deny", rule: "Bash(rm:*)" }]);
    expect(checkPermission("Bash", { command: "rm -rf /tmp" })).toBe("deny");
  });
});

// ─── Rule evaluation — Bash plain prefix specifier ───────────────────────────

describe("settings rules — Bash plain prefix specifier", () => {
  test("Bash(git) matches command starting with 'git'", () => {
    withRules([{ type: "allow", rule: "Bash(git)" }]);
    expect(checkPermission("Bash", { command: "git status" })).toBe("allow");
  });

  test("Bash(git) does NOT match 'echo git'", () => {
    withRules([{ type: "allow", rule: "Bash(git)" }]);
    expect(checkPermission("Bash", { command: "echo git" })).toBe("ask");
  });
});

// ─── Rule evaluation — Edit glob specifier ───────────────────────────────────

describe("settings rules — Edit glob specifier", () => {
  test("Edit(src/**) allows editing a file under src/", () => {
    withRules([{ type: "allow", rule: "Edit(src/**)" }]);
    expect(checkPermission("Edit", { file_path: "src/lib/foo.ts" })).toBe("allow");
  });

  test("Edit(src/**) does NOT match docs/readme.md", () => {
    withRules([{ type: "allow", rule: "Edit(src/**)" }]);
    expect(checkPermission("Edit", { file_path: "docs/readme.md" })).toBe("ask");
  });

  test("Edit(src/**) matches nested path src/a/b/c.ts", () => {
    withRules([{ type: "allow", rule: "Edit(src/**)" }]);
    expect(checkPermission("Edit", { file_path: "src/a/b/c.ts" })).toBe("allow");
  });

  test("deny Edit(*.secret) denies editing a .secret file", () => {
    withRules([{ type: "deny", rule: "Edit(*.secret)" }]);
    expect(checkPermission("Edit", { file_path: "config.secret" })).toBe("deny");
  });

  test("Write rule uses file_path specifier", () => {
    withRules([{ type: "allow", rule: "Write(tmp/**)" }]);
    expect(checkPermission("Write", { file_path: "tmp/output.txt" })).toBe("allow");
  });

  test("Read rule uses file_path specifier", () => {
    withRules([{ type: "allow", rule: "Read(docs/**)" }]);
    expect(checkPermission("Read", { file_path: "docs/guide.md" })).toBe("allow");
  });

  test("Edit exact path match (no glob)", () => {
    withRules([{ type: "allow", rule: "Edit(/etc/hosts)" }]);
    expect(checkPermission("Edit", { file_path: "/etc/hosts" })).toBe("allow");
  });
});

// ─── Rule evaluation — WebFetch URL specifier ────────────────────────────────

describe("settings rules — WebFetch URL specifier", () => {
  test("WebFetch(https://api.example.com) allows that exact URL prefix", () => {
    withRules([{ type: "allow", rule: "WebFetch(https://api.example.com)" }]);
    expect(checkPermission("WebFetch", { url: "https://api.example.com/v1/data" })).toBe("allow");
  });

  test("WebFetch specifier does NOT match a different domain", () => {
    withRules([{ type: "allow", rule: "WebFetch(https://api.example.com)" }]);
    // No rule match → allow anyway (WebFetch is a safe tool in ask mode)
    const decision = checkPermission("WebFetch", { url: "https://evil.com" });
    expect(decision).toBe("allow");
  });

  test("WebFetch glob pattern matches URL", () => {
    withRules([{ type: "deny", rule: "WebFetch(https://blocked.com/*)" }]);
    expect(checkPermission("WebFetch", { url: "https://blocked.com/page" })).toBe("deny");
  });
});

// ─── Rule evaluation — WebSearch specifier ───────────────────────────────────

describe("settings rules — WebSearch specifier", () => {
  test("WebSearch(safe *) allows queries matching the glob", () => {
    withRules([{ type: "allow", rule: "WebSearch(safe *)" }]);
    expect(checkPermission("WebSearch", { query: "safe query here" })).toBe("allow");
  });

  test("WebSearch specifier does NOT match a non-matching query", () => {
    withRules([{ type: "allow", rule: "WebSearch(safe *)" }]);
    // No match → falls through to default allow (WebSearch is not dangerous)
    expect(checkPermission("WebSearch", { query: "random stuff" })).toBe("allow");
  });
});

// ─── Rule evaluation — unknown tool with specifier ───────────────────────────

describe("settings rules — unknown tool with specifier", () => {
  test("unknown tool with specifier: specifier always matches (returns true)", () => {
    withRules([{ type: "deny", rule: "SomeCustomTool(any-pattern)" }]);
    expect(checkPermission("SomeCustomTool", { foo: "bar" })).toBe("deny");
  });

  test("unknown tool without specifier: rule matches by tool name", () => {
    withRules([{ type: "allow", rule: "SomeCustomTool" }]);
    expect(checkPermission("SomeCustomTool", {})).toBe("allow");
  });
});

// ─── parseRuleString fallback ─────────────────────────────────────────────────

describe("rule string parsing edge cases", () => {
  test("rule with no parentheses matches tool name exactly", () => {
    withRules([{ type: "allow", rule: "Bash" }]);
    expect(checkPermission("Bash", { command: "ls" })).toBe("allow");
  });

  test("rule that does not match the regex falls back to treating entire string as tool name", () => {
    withRules([{ type: "allow", rule: "Bash-special!" }]);
    expect(checkPermission("Bash", { command: "ls" })).toBe("ask");
  });
});

// ─── Rule order / priority ────────────────────────────────────────────────────

describe("rule evaluation order — first matching rule wins", () => {
  test("first rule wins: allow before deny", () => {
    withRules([
      { type: "allow", rule: "Bash(git:*)" },
      { type: "deny", rule: "Bash" },
    ]);
    expect(checkPermission("Bash", { command: "git status" })).toBe("allow");
  });

  test("first rule wins: deny before allow", () => {
    withRules([
      { type: "deny", rule: "Bash" },
      { type: "allow", rule: "Bash(git:*)" },
    ]);
    expect(checkPermission("Bash", { command: "git status" })).toBe("deny");
  });
});

// ─── detectDangerousCommand — additional patterns ────────────────────────────

describe("detectDangerousCommand() — additional patterns", () => {
  test("detects dd writing to /dev/sda as dangerous", () => {
    const result = detectDangerousCommand("dd if=/dev/zero of=/dev/sda bs=512");
    expect(result).not.toBeNull();
    expect(result).toContain("dispositivo");
  });

  test("detects dd writing to /dev/nvme0n1 as dangerous", () => {
    const result = detectDangerousCommand("dd if=/dev/zero of=/dev/nvme0n1");
    expect(result).not.toBeNull();
  });

  test("detects redirect to block device > /dev/sdb", () => {
    const result = detectDangerousCommand("cat /dev/zero > /dev/sdb");
    expect(result).not.toBeNull();
  });

  test("detects rm -rf on home directory", () => {
    const result = detectDangerousCommand("rm -rf ~/important");
    expect(result).not.toBeNull();
    expect(result).toContain("home");
  });

  test("detects shell redirect with braced variable ${VAR}", () => {
    const result = detectDangerousCommand("echo hello > ${OUTPUT_FILE}");
    expect(result).not.toBeNull();
  });

  test("safe redirect to a named file does not trigger", () => {
    expect(detectDangerousCommand("echo hello > /tmp/output.txt")).toBeNull();
  });

  test("safe git command does not trigger", () => {
    expect(detectDangerousCommand("git log --oneline")).toBeNull();
  });

  test("safe bun run does not trigger", () => {
    expect(detectDangerousCommand("bun run test")).toBeNull();
  });
});
