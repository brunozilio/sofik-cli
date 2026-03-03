import { loadSettings } from "./settings.ts";
import type { PermissionRule } from "./settings.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

export type PermissionMode =
  | "ask"              // Default — ask before running dangerous tools
  | "auto"             // Auto-approve all tools without prompting
  | "bypassPermissions" // Alias for auto
  | "plan"             // Plan-only mode — no writes/edits/bash allowed
  | "acceptEdits";     // Auto-approve file edits/writes, ask for Bash

/** What the permission check returns */
export type PermissionDecision = "allow" | "ask" | "deny";

// ─── State ─────────────────────────────────────────────────────────────────

let permissionMode: PermissionMode = "ask";

// Per-session allow-list: tools the user explicitly approved this session
const sessionAllowed = new Set<string>();

// Tools that are dangerous enough to require confirmation in "ask" mode
const DANGEROUS_TOOLS = new Set([
  "Bash", "Write", "Edit", "NotebookEdit",
]);

// Tools that mutate state (blocked in plan mode)
const MUTATING_TOOLS = new Set([
  "Bash", "Write", "Edit", "NotebookEdit", "EnterWorktree",
]);

// ─── Glob matcher ──────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  // Escape regex specials (except * and ?)
  let p = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // ** → matches anything including slashes
  p = p.replace(/\*\*/g, "\x00");
  // * → matches anything except slash
  p = p.replace(/\*/g, "[^/]*");
  // Restore **
  p = p.replace(/\x00/g, ".*");
  // ? → matches single non-slash char
  p = p.replace(/\?/g, "[^/]");
  return new RegExp(`^${p}$`);
}

function globMatch(pattern: string, str: string): boolean {
  try {
    return globToRegex(pattern).test(str);
  } catch {
    return str.includes(pattern);
  }
}

// ─── Rule parsing ──────────────────────────────────────────────────────────

function parseRuleString(ruleStr: string): { tool: string; specifier: string | null } {
  const m = ruleStr.match(/^(\w+)(?:\((.+)\))?$/);
  if (!m) return { tool: ruleStr, specifier: null };
  return { tool: m[1]!, specifier: m[2] ?? null };
}

function specifierMatches(
  specifier: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (toolName === "Bash") {
    const cmd = String(input["command"] ?? "");
    // "npm:*" → match commands starting with "npm "
    const colonIdx = specifier.indexOf(":");
    if (colonIdx !== -1) {
      const prefix = specifier.slice(0, colonIdx);
      const rest = specifier.slice(colonIdx + 1);
      if (!cmd.startsWith(prefix + " ") && cmd !== prefix) return false;
      if (rest === "*") return true;
      return globMatch(rest, cmd.slice(prefix.length + 1));
    }
    return cmd.startsWith(specifier);
  }

  if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
    const filePath = String(input["file_path"] ?? input["path"] ?? "");
    return globMatch(specifier, filePath) || filePath === specifier;
  }

  if (toolName === "WebFetch") {
    const url = String(input["url"] ?? "");
    return url.startsWith(specifier) || globMatch(specifier, url);
  }

  if (toolName === "WebSearch") {
    const query = String(input["query"] ?? "");
    return globMatch(specifier, query);
  }

  // Unknown tool — specifier matches everything
  return true;
}

function evaluateRules(
  rules: PermissionRule[],
  toolName: string,
  input: Record<string, unknown>,
): PermissionDecision | null {
  for (const rule of rules) {
    const { tool, specifier } = parseRuleString(rule.rule);
    if (tool !== toolName) continue;
    if (specifier && !specifierMatches(specifier, toolName, input)) continue;
    // Rule matches — return its decision
    return rule.type;
  }
  return null; // No rule matched
}

// ─── Dangerous command detection ───────────────────────────────────────────

const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rf]{1,3}\s+)*\/($|\s)/, reason: "rm no diretório raiz" },
  { pattern: /\brm\s+-[rf]+\s+~($|\/)/, reason: "rm no diretório home" },
  { pattern: /\bdd\b.*\bof=\/dev\/(sd|hd|nvme|disk)\w*/, reason: "dd para dispositivo de bloco" },
  { pattern: /\bmkfs\b/, reason: "formatando sistema de arquivos" },
  { pattern: />\s*\/dev\/(sd|hd|nvme|disk)\w*/, reason: "escrevendo no dispositivo de bloco" },
  { pattern: /\bsudo\s+rm\s+-[rf]/, reason: "sudo rm -rf" },
];

/** Returns a warning string if the command looks dangerous, null otherwise */
export function detectDangerousCommand(cmd: string): string | null {
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(cmd)) return `Comando perigoso detectado: ${reason}`;
  }
  // Shell redirects with variable expansion (could overwrite wrong file)
  if (/>\s*\$\{?\w+\}?/.test(cmd)) {
    return "Comando contém redirecionamento com variável shell — verifique o destino";
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function setPermissionMode(mode: PermissionMode): void {
  permissionMode = mode;
}

export function getPermissionMode(): PermissionMode {
  return permissionMode;
}

/**
 * Check whether a tool call should be allowed, asked, or denied.
 *
 * Decision priority:
 *  1. Plan mode — deny all mutating tools
 *  2. Auto/bypassPermissions — allow all
 *  3. Settings rules (allow/deny/ask) — evaluated in order
 *  4. acceptEdits mode — allow Write/Edit, ask for Bash
 *  5. Default ask-mode — ask for DANGEROUS_TOOLS unless session-approved
 */
export function checkPermission(
  toolName: string,
  input: Record<string, unknown>,
): PermissionDecision {
  // 1. Plan mode: block all mutations
  if (permissionMode === "plan") {
    if (MUTATING_TOOLS.has(toolName)) return "deny";
    return "allow";
  }

  // 2. Full auto: allow everything
  if (permissionMode === "auto" || permissionMode === "bypassPermissions") {
    return "allow";
  }

  // 3. Evaluate settings rules (from settings.json at all 3 levels)
  const settings = loadSettings();
  const ruleDecision = evaluateRules(settings.permissions ?? [], toolName, input);
  if (ruleDecision !== null) return ruleDecision;

  // 4. acceptEdits: auto-approve file edits/writes, ask for Bash
  if (permissionMode === "acceptEdits") {
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      return "allow";
    }
    if (!DANGEROUS_TOOLS.has(toolName)) return "allow";
    return "ask";
  }

  // 5. Default ask mode
  if (!DANGEROUS_TOOLS.has(toolName)) return "allow";

  // Check session allow-list (user already said "yes" to this specific call)
  const key = `${toolName}:${JSON.stringify(input).slice(0, 100)}`;
  if (sessionAllowed.has(key)) return "allow";

  return "ask";
}

/** Legacy helper — returns true if tool needs a confirmation prompt */
export function needsConfirmation(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  return checkPermission(toolName, input) === "ask";
}

/** Record that the user approved a specific tool call (session-scoped) */
export function approve(toolName: string, input: Record<string, unknown>): void {
  const key = `${toolName}:${JSON.stringify(input).slice(0, 100)}`;
  sessionAllowed.add(key);
}

/** Switch to auto-approve mode (equivalent to --auto flag) */
export function approveAll(): void {
  permissionMode = "auto";
}
