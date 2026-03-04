import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

// We import after setting up dirs so cache starts clean
import { loadSkills, invalidateSkillsCache, getSkill, loadCustomCommands } from "./skills.ts";

// ─── Directories ─────────────────────────────────────────────────────────────

// We write to the project-level .sofik dirs inside a temp directory,
// then process.chdir there so the functions pick them up.
const TMP_DIR = path.join(os.tmpdir(), `skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const SKILLS_DIR = path.join(TMP_DIR, ".sofik", "skills");
const COMMANDS_DIR = path.join(TMP_DIR, ".sofik", "commands");

let originalCwd: string;

beforeAll(() => {
  originalCwd = process.cwd();
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  process.chdir(TMP_DIR);
  // Start with a clean cache
  invalidateSkillsCache();
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  // Clear all skill files between tests and invalidate cache
  for (const f of fs.readdirSync(SKILLS_DIR)) {
    fs.unlinkSync(path.join(SKILLS_DIR, f));
  }
  for (const f of fs.readdirSync(COMMANDS_DIR)) {
    fs.unlinkSync(path.join(COMMANDS_DIR, f));
  }
  invalidateSkillsCache();
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function writeSkill(filename: string, content: string) {
  fs.writeFileSync(path.join(SKILLS_DIR, filename), content, "utf-8");
}

function writeCommand(filename: string, content: string) {
  fs.writeFileSync(path.join(COMMANDS_DIR, filename), content, "utf-8");
}

// ─── loadSkills ──────────────────────────────────────────────────────────────

describe("loadSkills", () => {
  test("empty skills dir → returns empty array (only project skills, no user skills to conflict)", () => {
    const skills = loadSkills(true);
    // Skills from ~/.sofik/skills/ (user home) may exist, but the project dir is empty.
    // We can only reliably check that project skills are empty; the result is an array.
    expect(Array.isArray(skills)).toBe(true);
  });

  test("finds .md files in .sofik/skills/", () => {
    writeSkill("my-skill.md", "# My Skill\nDo something useful.");
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "my-skill");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("my-skill");
  });

  test("finds .txt files in .sofik/skills/", () => {
    writeSkill("text-skill.txt", "Plain text skill content.");
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "text-skill");
    expect(skill).toBeDefined();
  });

  test("non-.md/.txt files are ignored", () => {
    writeSkill("not-a-skill.json", '{"data": 1}');
    writeSkill("ignore.py", "print('hi')");
    const skills = loadSkills(true);
    expect(skills.find((s) => s.name === "not-a-skill")).toBeUndefined();
    expect(skills.find((s) => s.name === "ignore")).toBeUndefined();
  });

  test("skill without frontmatter gets default description", () => {
    writeSkill("plain.md", "Just some content here.");
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "plain");
    expect(skill).toBeDefined();
    expect(skill!.description).toBe("Run the plain skill");
  });

  test("skill content without frontmatter is the full file body", () => {
    writeSkill("plain.md", "Just some content here.");
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "plain");
    expect(skill!.content).toBe("Just some content here.");
  });

  test("skill with frontmatter: extracts description", () => {
    writeSkill("fancy.md", `---\ndescription: My fancy skill\n---\nDo something fancy.`);
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "fancy");
    expect(skill).toBeDefined();
    expect(skill!.description).toBe("My fancy skill");
  });

  test("skill with frontmatter: extracts triggers", () => {
    writeSkill("triggered.md", `---\ndescription: Triggered skill\ntriggers: [commit, push]\n---\nContent.`);
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "triggered");
    expect(skill).toBeDefined();
    expect(skill!.triggers).toContain("commit");
    expect(skill!.triggers).toContain("push");
  });

  test("skill with frontmatter: body is content without frontmatter", () => {
    writeSkill("fronted.md", `---\ndescription: Test\n---\nReal content here.`);
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "fronted");
    expect(skill!.content).toBe("Real content here.");
  });

  test("skill source is the full file path", () => {
    writeSkill("sourced.md", "content");
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "sourced");
    // On macOS /var/folders is a symlink to /private/var/folders; resolve both
    const expectedSource = fs.realpathSync(path.join(SKILLS_DIR, "sourced.md"));
    const actualSource = fs.realpathSync(skill!.source);
    expect(actualSource).toBe(expectedSource);
  });

  test("skill with frontmatter and quoted trigger values", () => {
    writeSkill("quoted.md", `---\ndescription: Quoted\ntriggers: ["deploy", 'release']\n---\nBody.`);
    const skills = loadSkills(true);
    const skill = skills.find((s) => s.name === "quoted");
    expect(skill).toBeDefined();
    expect(skill!.triggers).toContain("deploy");
    expect(skill!.triggers).toContain("release");
  });

  test("multiple skills are all returned", () => {
    writeSkill("alpha.md", "Alpha content");
    writeSkill("beta.md", "Beta content");
    writeSkill("gamma.md", "Gamma content");
    const skills = loadSkills(true);
    const names = skills.map((s) => s.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("gamma");
  });

  test("caching: loadSkills() without reload returns same array reference", () => {
    writeSkill("cached.md", "content");
    const first = loadSkills(true); // force reload to prime cache
    const second = loadSkills(); // should return cached
    expect(first).toBe(second);
  });

  test("loadSkills(true) forces reload even when cached", () => {
    writeSkill("skill-a.md", "content A");
    const first = loadSkills(true);
    // Add a new skill after caching
    writeSkill("skill-b.md", "content B");
    const reloaded = loadSkills(true);
    expect(reloaded.find((s) => s.name === "skill-b")).toBeDefined();
  });

  test("file read error → skill is filtered out, others returned", () => {
    // Write a valid skill and an unreadable one
    writeSkill("good.md", "good content");
    // Create a directory with the .md extension to simulate a read error
    const badPath = path.join(SKILLS_DIR, "bad.md");
    fs.mkdirSync(badPath, { recursive: true });
    try {
      const skills = loadSkills(true);
      // The directory "bad.md" will cause readFileSync to fail, should be filtered
      expect(skills.find((s) => s.name === "good")).toBeDefined();
      expect(skills.find((s) => s.name === "bad")).toBeUndefined();
    } finally {
      fs.rmdirSync(badPath);
    }
  });
});

// ─── invalidateSkillsCache ───────────────────────────────────────────────────

describe("invalidateSkillsCache", () => {
  test("forces reload: new skills found after invalidation", () => {
    writeSkill("before.md", "before");
    loadSkills(true); // prime cache

    writeSkill("after.md", "after");
    // Without invalidation, "after" would not be found from cache
    invalidateSkillsCache();
    const skills = loadSkills();
    expect(skills.find((s) => s.name === "after")).toBeDefined();
  });

  test("can be called multiple times without error", () => {
    expect(() => {
      invalidateSkillsCache();
      invalidateSkillsCache();
    }).not.toThrow();
  });
});

// ─── getSkill ────────────────────────────────────────────────────────────────

describe("getSkill", () => {
  test("returns correct skill by name", () => {
    writeSkill("find-me.md", "---\ndescription: Find me!\n---\nContent.");
    invalidateSkillsCache();
    const skill = getSkill("find-me");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("find-me");
    expect(skill!.description).toBe("Find me!");
  });

  test("returns null for non-existent skill name", () => {
    invalidateSkillsCache();
    const skill = getSkill("does-not-exist-xyz-123");
    expect(skill).toBeNull();
  });

  test("returns correct skill among multiple", () => {
    writeSkill("one.md", "content one");
    writeSkill("two.md", "content two");
    writeSkill("three.md", "content three");
    invalidateSkillsCache();
    const skill = getSkill("two");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("two");
    expect(skill!.content).toBe("content two");
  });

  test("returns null when skill cache is empty and no files exist", () => {
    invalidateSkillsCache();
    // SKILLS_DIR is empty (cleared in beforeEach)
    const skill = getSkill("nonexistent");
    // It might find user skills from home dir, but "nonexistent" name should not be there
    expect(skill).toBeNull();
  });
});

// ─── loadCustomCommands ──────────────────────────────────────────────────────

describe("loadCustomCommands", () => {
  test("empty commands dir → returns empty array", () => {
    const commands = loadCustomCommands();
    expect(Array.isArray(commands)).toBe(true);
    expect(commands).toHaveLength(0);
  });

  test("finds .md files in .sofik/commands/", () => {
    writeCommand("my-cmd.md", "# My Command\nDoes something.");
    const commands = loadCustomCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("my-cmd");
  });

  test("first # line becomes description", () => {
    writeCommand("with-header.md", "# Do the thing\nMore content.");
    const commands = loadCustomCommands();
    const cmd = commands.find((c) => c.name === "with-header");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("Do the thing");
  });

  test("multiple # marks in first line: description strips leading hashes", () => {
    writeCommand("multi-hash.md", "## Section Header\nContent.");
    const commands = loadCustomCommands();
    const cmd = commands.find((c) => c.name === "multi-hash");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("Section Header");
  });

  test("no # first line → description is 'Custom command: name'", () => {
    writeCommand("no-header.md", "Just content, no header.");
    const commands = loadCustomCommands();
    const cmd = commands.find((c) => c.name === "no-header");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("Custom command: no-header");
  });

  test("non-.md files in commands dir are ignored", () => {
    writeCommand("script.sh", "#!/bin/bash\necho hi");
    writeCommand("data.txt", "some data");
    const commands = loadCustomCommands();
    // Only .md files
    expect(commands.find((c) => c.name === "script")).toBeUndefined();
    expect(commands.find((c) => c.name === "data")).toBeUndefined();
  });

  test("command content is the full file content", () => {
    const body = "# Deploy\nRun deployment steps.";
    writeCommand("deploy.md", body);
    const commands = loadCustomCommands();
    const cmd = commands.find((c) => c.name === "deploy");
    expect(cmd!.content).toBe(body);
  });

  test("multiple commands are all returned", () => {
    writeCommand("cmd-a.md", "# Command A\nDo A.");
    writeCommand("cmd-b.md", "# Command B\nDo B.");
    const commands = loadCustomCommands();
    expect(commands).toHaveLength(2);
    const names = commands.map((c) => c.name);
    expect(names).toContain("cmd-a");
    expect(names).toContain("cmd-b");
  });

  test("returns empty array when commands directory does not exist", () => {
    // Temporarily rename the commands dir
    const altDir = COMMANDS_DIR + "_bak";
    fs.renameSync(COMMANDS_DIR, altDir);
    try {
      const commands = loadCustomCommands();
      expect(commands).toHaveLength(0);
    } finally {
      fs.renameSync(altDir, COMMANDS_DIR);
    }
  });

  test("file read error → command filtered out, others returned", () => {
    writeCommand("valid.md", "# Valid\nContent.");
    // Create a directory with .md extension to cause read error
    const badCmdPath = path.join(COMMANDS_DIR, "broken.md");
    fs.mkdirSync(badCmdPath, { recursive: true });
    try {
      const commands = loadCustomCommands();
      expect(commands.find((c) => c.name === "valid")).toBeDefined();
      expect(commands.find((c) => c.name === "broken")).toBeUndefined();
    } finally {
      fs.rmdirSync(badCmdPath);
    }
  });

  test("empty file → description is 'Custom command: name'", () => {
    writeCommand("empty.md", "");
    const commands = loadCustomCommands();
    const cmd = commands.find((c) => c.name === "empty");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("Custom command: empty");
  });
});
