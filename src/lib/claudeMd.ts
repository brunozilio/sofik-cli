import fs from "fs";
import path from "path";
import os from "os";

const CLAUDE_MD_MAX_LINES = 200;

function readIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function truncateLines(content: string, max: number): string {
  const lines = content.split("\n");
  if (lines.length <= max) return content;
  return lines.slice(0, max).join("\n") + `\n\n[... truncated at ${max} lines]`;
}

export interface ClaudeMdContent {
  projectInstructions: string | null;
  localInstructions: string | null;
  userInstructions: string | null;
  memory: string | null;
}

interface ClaudeMdCache {
  content: ClaudeMdContent;
  mtimes: Record<string, number>;
}

let _claudeMdCache: ClaudeMdCache | null = null;

function getMtime(filePath: string): number {
  try { return fs.statSync(filePath).mtimeMs; } catch { return 0; }
}

export function loadClaudeMd(): ClaudeMdContent {
  const cwd = process.cwd();
  const home = os.homedir();

  // Search order: project-level, local .sofik/, user-level ~/.sofik/
  const projectPath = path.join(cwd, "SOFIK.md");
  const localPath = path.join(cwd, ".sofik", "SOFIK.md");
  const userPath = path.join(home, ".sofik", "SOFIK.md");
  const memoryPath = path.join(home, ".sofik", "MEMORY.md");

  const paths = [projectPath, localPath, userPath, memoryPath];

  if (_claudeMdCache) {
    const changed = paths.some((p) => getMtime(p) !== _claudeMdCache!.mtimes[p]);
    if (!changed) return _claudeMdCache.content;
  }

  const mtimes: Record<string, number> = {};
  for (const p of paths) mtimes[p] = getMtime(p);

  const content: ClaudeMdContent = {
    projectInstructions: readIfExists(projectPath),
    localInstructions: readIfExists(localPath),
    userInstructions: readIfExists(userPath),
    memory: readIfExists(memoryPath),
  };

  _claudeMdCache = { content, mtimes };
  return content;
}

export function buildClaudeMdSection(content: ClaudeMdContent): string {
  const sections: string[] = [];

  if (content.userInstructions) {
    sections.push(
      `<user_instructions>\n${truncateLines(content.userInstructions, CLAUDE_MD_MAX_LINES)}\n</user_instructions>`
    );
  }

  if (content.projectInstructions) {
    sections.push(
      `<project_instructions>\n${truncateLines(content.projectInstructions, CLAUDE_MD_MAX_LINES)}\n</project_instructions>`
    );
  }

  if (content.localInstructions) {
    sections.push(
      `<local_instructions>\n${truncateLines(content.localInstructions, CLAUDE_MD_MAX_LINES)}\n</local_instructions>`
    );
  }

  if (content.memory) {
    sections.push(
      `<memory>\n${truncateLines(content.memory, CLAUDE_MD_MAX_LINES)}\n</memory>`
    );
  }

  return sections.join("\n\n");
}

export function updateMemory(newContent: string): void {
  const memoryPath = path.join(os.homedir(), ".sofik", "MEMORY.md");
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, newContent, "utf-8");
}
