import { mock, test, expect, describe, beforeEach, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import os from "os";

// ─── Temp dir isolation ───────────────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "sofik-sysprompt-"));
const ORIG_CWD = process.cwd();

import { invalidateSettingsCache } from "./settings.ts";
import { setPermissionMode } from "./permissions.ts";
import { invalidateSkillsCache, type Skill } from "./skills.ts";
import { getProjectMemoryDir } from "./session.ts";

// claudeMd and skills are ok to keep mocked since they have their own test file
// that doesn't get broken (claudeMd.test.ts is not affected, skills.test.ts reads
// from disk and isn't affected by skills mock either).
// We keep the claudeMd mock to control _claudeMdSection in tests.

let _claudeMdSection = "";

mock.module("./claudeMd.ts", () => ({
  loadClaudeMd: () => ({ projectInstructions: null, localInstructions: null, userInstructions: null, memory: null }),
  buildClaudeMdSection: () => _claudeMdSection,
}));

import { buildSystemPrompt, COMPACTION_PROMPT } from "./systemPrompt.ts";

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(join(TEST_DIR, ".sofik"), { recursive: true });
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), "{}", "utf-8");
  process.chdir(TEST_DIR);
  invalidateSettingsCache();
  invalidateSkillsCache();
});

afterAll(() => {
  process.chdir(ORIG_CWD);
  invalidateSettingsCache();
  invalidateSkillsCache();
  rmSync(TEST_DIR, { recursive: true });
});

beforeEach(() => {
  // Reset to clean state
  setPermissionMode("ask");
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), "{}", "utf-8");
  invalidateSettingsCache();
  // Clean up skills
  invalidateSkillsCache();
  // Reset claudeMd section
  _claudeMdSection = "";
  // Clean up project memory if it was written
  const memDir = getProjectMemoryDir(process.cwd());
  const memFile = join(memDir, "MEMORY.md");
  if (existsSync(memFile)) {
    unlinkSync(memFile);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withSettings(settings: Record<string, unknown>) {
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), JSON.stringify(settings), "utf-8");
  invalidateSettingsCache();
}

function withProjectMemory(content: string) {
  // Use process.cwd() (not TEST_DIR) to match the hash that buildSystemPrompt() will compute,
  // since macOS resolves /var -> /private/var when cwd is queried.
  const memDir = getProjectMemoryDir(process.cwd());
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, "MEMORY.md"), content, "utf-8");
}

function withSkills(skills: Array<{ name: string; description: string }>) {
  // Use process.cwd() to match what loadSkills() sees (macOS /var → /private/var)
  const skillsDir = join(process.cwd(), ".sofik", "skills");
  mkdirSync(skillsDir, { recursive: true });
  for (const s of skills) {
    writeFileSync(join(skillsDir, `${s.name}.md`), `---\ndescription: ${s.description}\n---\n${s.description}`, "utf-8");
  }
  invalidateSkillsCache();
}

function clearSkills() {
  const skillsDir = join(process.cwd(), ".sofik", "skills");
  if (existsSync(skillsDir)) {
    rmSync(skillsDir, { recursive: true });
  }
  invalidateSkillsCache();
}

// ─── buildSystemPrompt tests ──────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  test("returns a string", () => {
    const result = buildSystemPrompt();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("contains current working directory", () => {
    const result = buildSystemPrompt();
    expect(result).toContain(process.cwd());
  });

  test("contains platform", () => {
    const result = buildSystemPrompt();
    expect(result).toContain(process.platform);
  });

  test("contains date in YYYY-MM-DD format", () => {
    const result = buildSystemPrompt();
    const dateRegex = /\d{4}-\d{2}-\d{2}/;
    expect(dateRegex.test(result)).toBe(true);
  });

  test("contains Sofik AI", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("Sofik AI");
  });

  test("contains tool names in ask mode", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("Bash");
    expect(result).toContain("Read");
    expect(result).toContain("Write");
    expect(result).toContain("Edit");
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
    expect(result).toContain("WebFetch");
    expect(result).toContain("WebSearch");
  });

  test("in ask mode: all tools shown including mutating ones", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("**Bash**");
    expect(result).toContain("**Write**");
    expect(result).toContain("**Edit**");
  });

  test("in plan mode: mutating tools not shown in capabilities", () => {
    setPermissionMode("plan");
    const result = buildSystemPrompt();
    expect(result).toContain("PLAN MODE");
    expect(result).not.toContain("**Bash**");
    expect(result).not.toContain("**Write**");
    expect(result).not.toContain("**Edit**");
  });

  test("in plan mode: non-mutating tools still shown", () => {
    setPermissionMode("plan");
    const result = buildSystemPrompt();
    expect(result).toContain("**Read**");
    expect(result).toContain("**Glob**");
    expect(result).toContain("**Grep**");
  });

  test("with language setting: contains language instruction", () => {
    withSettings({ language: "Portuguese" });
    const result = buildSystemPrompt();
    expect(result).toContain("Portuguese");
    expect(result).toContain("Language");
    expect(result).toContain("Always respond in Portuguese");
  });

  test("without language: no language section", () => {
    const result = buildSystemPrompt();
    expect(result).not.toContain("Always respond in");
  });

  test("with brevity strict: contains CRITICAL and Go straight to the point", () => {
    withSettings({ brevity: "strict" });
    const result = buildSystemPrompt();
    expect(result).toContain("CRITICAL");
    expect(result).toContain("Go straight to the point");
  });

  test("with brevity focused: contains IMPORTANT and Go straight to the point", () => {
    withSettings({ brevity: "focused" });
    const result = buildSystemPrompt();
    expect(result).toContain("IMPORTANT");
    expect(result).toContain("Go straight to the point");
  });

  test("with brevity polished: contains Be concise", () => {
    withSettings({ brevity: "polished" });
    const result = buildSystemPrompt();
    expect(result).toContain("Be concise");
  });

  test("without brevity: no Output efficiency section", () => {
    const result = buildSystemPrompt();
    expect(result).not.toContain("# Output efficiency");
  });

  test("with skills: contains skills section with skill names", () => {
    withSkills([
      { name: "commit", description: "Create a git commit" },
      { name: "review", description: "Review code changes" },
    ]);
    const result = buildSystemPrompt();
    expect(result).toContain("<skills>");
    expect(result).toContain("commit");
    expect(result).toContain("review");
    expect(result).toContain("Create a git commit");
    clearSkills();
  });

  test("without skills: no skills section", () => {
    clearSkills();
    const result = buildSystemPrompt();
    expect(result).not.toContain("<skills>");
  });

  test("with projectMemory: contains project_memory section", () => {
    withProjectMemory("Remember: use TypeScript strict mode");
    const result = buildSystemPrompt();
    expect(result).toContain("<project_memory>");
    expect(result).toContain("Remember: use TypeScript strict mode");
    expect(result).toContain("</project_memory>");
  });

  test("without projectMemory: no project_memory section", () => {
    const result = buildSystemPrompt();
    expect(result).not.toContain("<project_memory>");
  });

  test("with claudeMd content: appears in output", () => {
    _claudeMdSection = "<user_instructions>\nUse bun instead of node\n</user_instructions>";
    const result = buildSystemPrompt();
    expect(result).toContain("Use bun instead of node");
  });

  test("without claudeMd content: no claudeMd section in output", () => {
    const result = buildSystemPrompt();
    expect(result).not.toContain("<user_instructions>");
  });

  test("contains capabilities section", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("<capabilities>");
    expect(result).toContain("</capabilities>");
  });

  test("contains slash commands section", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("<slash_commands>");
    expect(result).toContain("</slash_commands>");
  });

  test("contains home directory", () => {
    const result = buildSystemPrompt();
    expect(result).toContain(os.homedir());
  });

  test("contains shell", () => {
    const result = buildSystemPrompt();
    expect(result).toContain("Shell:");
  });
});

describe("COMPACTION_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(typeof COMPACTION_PROMPT).toBe("string");
    expect(COMPACTION_PROMPT.length).toBeGreaterThan(0);
  });

  test("contains Task Overview", () => {
    expect(COMPACTION_PROMPT).toContain("Task Overview");
  });

  test("contains summary tags", () => {
    expect(COMPACTION_PROMPT).toContain("<summary>");
    expect(COMPACTION_PROMPT).toContain("</summary>");
  });

  test("contains Current State section", () => {
    expect(COMPACTION_PROMPT).toContain("Current State");
  });

  test("contains Next Steps section", () => {
    expect(COMPACTION_PROMPT).toContain("Next Steps");
  });
});
