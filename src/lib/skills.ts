import fs from "fs";
import path from "path";
import os from "os";

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string; // file path
  triggers?: string[]; // keywords that auto-trigger this skill
}

/** Convert a filename to a skill name: "commit-message.md" → "commit-message" */
function fileToSkillName(filename: string): string {
  return filename.replace(/\.(md|txt)$/i, "");
}

/** Parse a skill file — extract optional frontmatter description and triggers */
function parseSkillFile(content: string, name: string, source: string): Skill {
  let description = `Run the ${name} skill`;
  const triggers: string[] = [];
  let body = content;

  // Parse simple YAML-like frontmatter: ---\nkey: value\n---
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const meta = frontmatterMatch[1]!;
    body = frontmatterMatch[2]!;

    const descMatch = meta.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1]!.trim();

    const triggerMatch = meta.match(/^triggers:\s*\[([^\]]+)\]/m);
    if (triggerMatch) {
      triggers.push(
        ...triggerMatch[1]!.split(",").map((t) => t.trim().replace(/^["']|["']$/g, ""))
      );
    }
  }

  return { name, description, content: body.trim(), source, triggers };
}

/** Discover skills from a directory */
function discoverInDir(dir: string): Skill[] {
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((f) => /\.(md|txt)$/i.test(f))
      .map((f) => {
        const name = fileToSkillName(f);
        const source = path.join(dir, f);
        try {
          const content = fs.readFileSync(source, "utf-8");
          return parseSkillFile(content, name, source);
        } catch {
          return null;
        }
      })
      .filter((s): s is Skill => s !== null);
  } catch {
    return [];
  }
}

let _cachedSkills: Skill[] | null = null;

/** Load all skills from user (~/.sofik/skills/) and project (.sofik/skills/) dirs */
export function loadSkills(reload = false): Skill[] {
  if (_cachedSkills && !reload) return _cachedSkills;

  const home = os.homedir();
  const cwd = process.cwd();

  const userSkills = discoverInDir(path.join(home, ".sofik", "skills"));
  const projectSkills = discoverInDir(path.join(cwd, ".sofik", "skills"));

  // Project skills override user skills with the same name
  const byName = new Map<string, Skill>();
  for (const s of userSkills) byName.set(s.name, s);
  for (const s of projectSkills) byName.set(s.name, s); // project wins

  _cachedSkills = Array.from(byName.values());
  return _cachedSkills;
}

export function invalidateSkillsCache(): void {
  _cachedSkills = null;
}

export function getSkill(name: string): Skill | null {
  return loadSkills().find((s) => s.name === name) ?? null;
}

/** Load custom slash commands from .sofik/commands/*.md */
export interface CustomCommand {
  name: string;
  description: string;
  content: string;
}

export function loadCustomCommands(): CustomCommand[] {
  const cwd = process.cwd();
  const cmdDir = path.join(cwd, ".sofik", "commands");

  try {
    const entries = fs.readdirSync(cmdDir);
    return entries
      .filter((f) => /\.md$/i.test(f))
      .map((f) => {
        const name = fileToSkillName(f);
        const source = path.join(cmdDir, f);
        try {
          const content = fs.readFileSync(source, "utf-8");
          // First line starting with # becomes the description
          const firstLine = content.split("\n")[0] ?? "";
          const description = firstLine.startsWith("#")
            ? firstLine.replace(/^#+\s*/, "").trim()
            : `Custom command: ${name}`;
          return { name, description, content };
        } catch {
          return null;
        }
      })
      .filter((c): c is CustomCommand => c !== null);
  } catch {
    return [];
  }
}
