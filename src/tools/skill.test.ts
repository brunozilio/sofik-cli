import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { skillTool } from "./skill.ts";
import { invalidateSkillsCache } from "../lib/skills.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-skill-test-"));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterAll(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  // Clean up skill files
  try {
    fs.rmSync(path.join(tmpDir, ".sofik", "skills"), { recursive: true });
  } catch {}
  invalidateSkillsCache();
});

function createSkill(name: string, content: string): void {
  const skillsDir = path.join(tmpDir, ".sofik", "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  // The first line should be the description (after the # heading)
  fs.writeFileSync(path.join(skillsDir, `${name}.md`), content, "utf-8");
  invalidateSkillsCache();
}

async function skill(input: Record<string, unknown>): Promise<string> {
  return skillTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("skillTool metadata", () => {
  test("name is 'Skill'", () => {
    expect(skillTool.name).toBe("Skill");
  });

  test("has a description", () => {
    expect(typeof skillTool.description).toBe("string");
    expect(skillTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof skillTool.execute).toBe("function");
  });

  test("input_schema requires skill", () => {
    expect(skillTool.input_schema.required).toContain("skill");
  });

  test("input_schema has args property", () => {
    expect(skillTool.input_schema.properties).toHaveProperty("args");
  });
});

// ── List skills ────────────────────────────────────────────────────────────────

describe("skillTool — list", () => {
  test("returns message when no skills exist", async () => {
    const result = await skill({ skill: "list" });
    expect(result).toContain("Nenhuma habilidade encontrada");
    expect(result).toContain(".sofik/skills/");
  });

  test("returns list of skills when skills exist", async () => {
    createSkill("commit", "# commit\nGenerate a commit message\n\nCreate a commit.");
    const result = await skill({ skill: "list" });
    expect(result).toContain("commit");
    expect(result).toContain("Habilidades disponíveis");
  });

  test("shows skill count in list", async () => {
    createSkill("skill-a", "# skill-a\nSkill A description\n\nContent A.");
    createSkill("skill-b", "# skill-b\nSkill B description\n\nContent B.");
    const result = await skill({ skill: "list" });
    expect(result).toContain("2");
  });

  test("list includes source path", async () => {
    createSkill("my-skill", "# my-skill\nMy description\n\nContent.");
    const result = await skill({ skill: "list" });
    expect(result).toContain(".sofik/skills/");
  });
});

// ── Execute skill ──────────────────────────────────────────────────────────────

describe("skillTool — execute skill", () => {
  test("executes an existing skill and returns its content", async () => {
    createSkill("review", "# review\nCode review skill\n\nPlease review the code carefully.");
    const result = await skill({ skill: "review" });
    expect(result).toContain("review");
    expect(result).toContain("INÍCIO DA HABILIDADE");
    expect(result).toContain("FIM DA HABILIDADE");
  });

  test("returns skill name in output", async () => {
    createSkill("deploy", "# deploy\nDeploy app\n\nDeploy to production.");
    const result = await skill({ skill: "deploy" });
    expect(result).toContain("deploy");
  });

  test("returns skill source path in output", async () => {
    createSkill("test", "# test\nTest skill\n\nRun tests.");
    const result = await skill({ skill: "test" });
    expect(result).toContain(".sofik/skills/");
  });

  test("includes instruction to follow the skill", async () => {
    createSkill("follow", "# follow\nFollow me\n\nDo as instructed.");
    const result = await skill({ skill: "follow" });
    expect(result).toContain("Siga as instruções");
  });

  test("appends args when provided", async () => {
    createSkill("with-args", "# with-args\nArgs skill\n\nBase content.");
    const result = await skill({ skill: "with-args", args: "extra argument here" });
    expect(result).toContain("extra argument here");
  });

  test("skill content without args does not have extra text", async () => {
    createSkill("no-args", "# no-args\nNo args\n\nBase content only.");
    const result = await skill({ skill: "no-args" });
    // Should not contain undefined or empty args
    expect(result).not.toContain("undefined");
  });
});

// ── Skill not found ────────────────────────────────────────────────────────────

describe("skillTool — skill not found", () => {
  test("returns error when skill does not exist", async () => {
    const result = await skill({ skill: "nonexistent-skill-xyz" });
    expect(result).toContain("não encontrada");
    expect(result).toContain("nonexistent-skill-xyz");
  });

  test("lists available skills when skill not found", async () => {
    createSkill("available-skill", "# available-skill\nAvailable\n\nContent.");
    const result = await skill({ skill: "not-this-one" });
    expect(result).toContain("available-skill");
  });

  test("mentions no skills when none defined and skill not found", async () => {
    const result = await skill({ skill: "missing" });
    expect(result).toContain("Nenhuma habilidade");
  });

  test("'list' keyword works even with no skills", async () => {
    const result = await skill({ skill: "list" });
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe("skillTool — edge cases", () => {
  test("skill name is trimmed of whitespace", async () => {
    createSkill("trimmed", "# trimmed\nTrimmed skill\n\nContent.");
    const result = await skill({ skill: "  trimmed  " });
    expect(result).toContain("INÍCIO DA HABILIDADE");
  });

  test("args is trimmed of whitespace", async () => {
    createSkill("args-trim", "# args-trim\nArgs trim\n\nBase.");
    const result = await skill({ skill: "args-trim", args: "   spaced args   " });
    expect(result).toContain("spaced args");
  });

  test("empty args string is treated as no args", async () => {
    createSkill("empty-args", "# empty-args\nEmpty args\n\nBase content.");
    const result = await skill({ skill: "empty-args", args: "" });
    // Should not append empty args
    expect(result).toContain("Base content");
  });
});
