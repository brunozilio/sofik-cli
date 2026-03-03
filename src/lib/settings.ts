import fs from "fs";
import path from "path";
import os from "os";

export interface PermissionRule {
  /** Whether to allow, deny, or ask for this rule */
  type: "allow" | "deny" | "ask";
  /**
   * Rule pattern: "Tool" or "Tool(specifier)"
   * Examples:
   *   "Edit(docs/**)"           — glob match on file_path
   *   "Bash(git:*)"             — commands starting with "git "
   *   "WebFetch(https://api.)"  — URL prefix match
   *   "Read(~/.zshrc)"          — exact file match
   */
  rule: string;
}

export type SettingsDefaultMode =
  | "ask"              // Default: ask for dangerous tools
  | "auto"             // Auto-approve everything
  | "bypassPermissions" // Alias for auto
  | "plan";            // Plan-only mode (no mutations)

export interface ProxySettings {
  /** Proxy URL, e.g. "http://proxy.corp.example.com:8080" */
  url?: string;
  /** Hostnames / patterns that bypass the proxy (combined with NO_PROXY env var) */
  noProxy?: string[];
}

export interface Settings {
  /** Permission rules evaluated in order */
  permissions?: PermissionRule[];
  /** Default permission mode on startup */
  defaultMode?: SettingsDefaultMode;
  /** Additional directories the agent can access outside cwd */
  additionalDirectories?: string[];
  /** Disable sandbox restrictions for Bash */
  disableSandbox?: boolean;
  /** Glob patterns to exclude from memory loading */
  memoryExcludes?: string[];
  /** Preferred model override */
  model?: string;
  /** Hooks configuration */
  hooks?: Record<string, unknown>;
  /** Language for AI responses (e.g. "Portuguese", "Spanish") */
  language?: string;
  /** Output verbosity: strict (minimal), focused (brief), polished (refined) */
  brevity?: "strict" | "focused" | "polished";
  /** HTTP/HTTPS proxy configuration */
  proxy?: ProxySettings;
}

function readJson(filePath: string): Settings {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

function mergeSettings(...layers: Settings[]): Settings {
  const out: Settings = {};
  for (const s of layers) {
    if (s.defaultMode !== undefined) out.defaultMode = s.defaultMode;
    if (s.disableSandbox !== undefined) out.disableSandbox = s.disableSandbox;
    if (s.model !== undefined) out.model = s.model;
    if (s.hooks) out.hooks = { ...out.hooks, ...s.hooks };
    if (s.permissions?.length)
      out.permissions = [...(out.permissions ?? []), ...s.permissions];
    if (s.additionalDirectories?.length)
      out.additionalDirectories = [
        ...(out.additionalDirectories ?? []),
        ...s.additionalDirectories,
      ];
    if (s.memoryExcludes?.length)
      out.memoryExcludes = [...(out.memoryExcludes ?? []), ...s.memoryExcludes];
    if (s.language !== undefined) out.language = s.language;
    if (s.brevity !== undefined) out.brevity = s.brevity;
    if (s.proxy !== undefined) out.proxy = s.proxy;
  }
  return out;
}

interface SettingsCache {
  value: Settings;
  mtimes: Record<string, number>;
}

let _cache: SettingsCache | null = null;

function getMtime(filePath: string): number {
  try { return fs.statSync(filePath).mtimeMs; } catch { return 0; }
}

/**
 * Load settings from all 3 levels (user < project < local).
 * Cache is invalidated automatically when any settings file changes on disk.
 */
export function loadSettings(reload = false): Settings {
  const home = os.homedir();
  const cwd = process.cwd();
  const paths = [
    path.join(home, ".sofik", "settings.json"),
    path.join(cwd, ".sofik", "settings.json"),
    path.join(cwd, ".sofik", "settings.local.json"),
  ];

  if (!reload && _cache) {
    const changed = paths.some((p) => getMtime(p) !== _cache!.mtimes[p]);
    if (!changed) return _cache.value;
  }

  const mtimes: Record<string, number> = {};
  for (const p of paths) mtimes[p] = getMtime(p);

  _cache = {
    value: mergeSettings(
      readJson(paths[0]!),   // 1. user
      readJson(paths[1]!),   // 2. project
      readJson(paths[2]!),   // 3. local
    ),
    mtimes,
  };
  return _cache.value;
}

export function invalidateSettingsCache(): void {
  _cache = null;
}

/** Persist settings to .sofik/settings.json in the current project. */
export function saveProjectSettings(updates: Partial<Settings>): void {
  const dir = path.join(process.cwd(), ".sofik");
  const file = path.join(dir, "settings.json");
  fs.mkdirSync(dir, { recursive: true });
  let existing: Settings = {};
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf-8")) as Settings;
  } catch { /* start fresh */ }
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...updates }, null, 2), "utf-8");
  invalidateSettingsCache();
}

const KNOWN_SETTINGS_KEYS = new Set([
  "permissions", "defaultMode", "additionalDirectories", "disableSandbox",
  "memoryExcludes", "model", "hooks", "language", "brevity", "proxy",
]);

const VALID_DEFAULT_MODES = new Set(["ask", "auto", "bypassPermissions", "plan"]);
const VALID_BREVITY = new Set(["strict", "focused", "polished"]);

/** Returns a list of validation error strings. Empty array = valid. */
export function validateSettings(s: Settings): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(s)) {
    if (!KNOWN_SETTINGS_KEYS.has(key)) {
      errors.push(`Unknown settings key: "${key}"`);
    }
  }
  if (s.defaultMode && !VALID_DEFAULT_MODES.has(s.defaultMode)) {
    errors.push(`Invalid defaultMode: "${s.defaultMode}". Valid: ${[...VALID_DEFAULT_MODES].join(", ")}`);
  }
  if (s.brevity && !VALID_BREVITY.has(s.brevity)) {
    errors.push(`Invalid brevity: "${s.brevity}". Valid: ${[...VALID_BREVITY].join(", ")}`);
  }
  if (s.permissions) {
    for (let i = 0; i < s.permissions.length; i++) {
      const p = s.permissions[i]!;
      if (!["allow", "deny", "ask"].includes(p.type)) {
        errors.push(`permissions[${i}].type must be "allow", "deny", or "ask", got "${p.type}"`);
      }
      if (typeof p.rule !== "string" || !p.rule) {
        errors.push(`permissions[${i}].rule must be a non-empty string`);
      }
    }
  }
  if (s.proxy) {
    if (s.proxy.url !== undefined && typeof s.proxy.url !== "string") {
      errors.push(`proxy.url must be a string`);
    }
    if (s.proxy.url) {
      try { new URL(s.proxy.url); } catch {
        errors.push(`proxy.url is not a valid URL: "${s.proxy.url}"`);
      }
    }
    if (s.proxy.noProxy !== undefined) {
      if (!Array.isArray(s.proxy.noProxy)) {
        errors.push(`proxy.noProxy must be an array of strings`);
      } else {
        for (let i = 0; i < s.proxy.noProxy.length; i++) {
          if (typeof s.proxy.noProxy[i] !== "string") {
            errors.push(`proxy.noProxy[${i}] must be a string`);
          }
        }
      }
    }
  }
  return errors;
}
