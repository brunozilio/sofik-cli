/**
 * Hooks system — executes bash/HTTP callbacks before/after tool use.
 * Hooks are configured in SOFIK.md under a `hooks:` section.
 *
 * Example SOFIK.md:
 *   hooks:
 *     PostToolUse:
 *       - matcher: { tools: ["Bash"] }
 *         hooks:
 *           - type: bash
 *             command: "echo 'Bash ran: $TOOL_INPUT'"
 */
import { execSync } from "child_process";
import { fetchWithProxy } from "./fetchWithProxy.ts";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./logger.ts";

type HookType = "bash" | "http";

interface BashHook {
  type: "bash";
  command: string;
}

interface HttpHook {
  type: "http";
  url: string;
}

type Hook = BashHook | HttpHook;

interface HookEntry {
  matcher: { tools?: string[] };
  hooks: Hook[];
}

interface HooksConfig {
  PostToolUse?: HookEntry[];
  PreToolUse?: HookEntry[];
}

function loadHooksConfig(): HooksConfig {
  const candidates = [
    path.join(process.cwd(), "SOFIK.md"),
    path.join(process.cwd(), ".sofik", "SOFIK.md"),
    path.join(os.homedir(), ".sofik", "SOFIK.md"),
  ];

  for (const p of candidates) {
    try {
      const content = fs.readFileSync(p, "utf-8");
      // Extract YAML-ish hooks block between ```hooks and ``` or look for JSON
      const jsonMatch = content.match(/```json:hooks\n([\s\S]*?)```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]!) as HooksConfig;
      }
    } catch { /* skip */ }
  }
  return {};
}

let hooksConfig: HooksConfig | null = null;

function getHooks(): HooksConfig {
  if (!hooksConfig) hooksConfig = loadHooksConfig();
  return hooksConfig;
}

function matchesTool(entry: HookEntry, toolName: string): boolean {
  if (!entry.matcher.tools) return true;
  return entry.matcher.tools.some(
    (t) => t === toolName || t === "*" || toolName.startsWith(t)
  );
}

async function runHook(hook: Hook, context: Record<string, string>): Promise<void> {
  if (hook.type === "bash") {
    const env: Record<string, string> = { ...process.env as Record<string, string>, ...context };
    try {
      logger.app.debug("Hook bash executado", { command: hook.command.slice(0, 100), tool: context.TOOL_NAME });
      execSync(hook.command, { env, stdio: "ignore", timeout: 10_000 });
    } catch (err) {
      logger.app.warn("Hook bash falhou (best-effort)", { command: hook.command.slice(0, 100), error: err instanceof Error ? err.message : String(err) });
    }
  } else if (hook.type === "http") {
    try {
      logger.app.debug("Hook HTTP enviado", { url: hook.url, tool: context.TOOL_NAME });
      await fetchWithProxy(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      logger.app.warn("Hook HTTP falhou (best-effort)", { url: hook.url, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export async function runPreToolUseHooks(toolName: string, input: unknown): Promise<void> {
  const config = getHooks();
  if (!config.PreToolUse) return;
  const ctx = { TOOL_NAME: toolName, TOOL_INPUT: JSON.stringify(input) };
  let ran = 0;
  for (const entry of config.PreToolUse) {
    if (matchesTool(entry, toolName)) {
      for (const hook of entry.hooks) { await runHook(hook, ctx); ran++; }
    }
  }
  if (ran > 0) logger.app.info("PreToolUseHooks executados", { tool: toolName, hooksRan: ran });
}

export async function runPostToolUseHooks(
  toolName: string,
  input: unknown,
  result: string
): Promise<void> {
  const config = getHooks();
  if (!config.PostToolUse) return;
  const ctx = { TOOL_NAME: toolName, TOOL_INPUT: JSON.stringify(input), TOOL_RESULT: result.slice(0, 500) };
  let ran = 0;
  for (const entry of config.PostToolUse) {
    if (matchesTool(entry, toolName)) {
      for (const hook of entry.hooks) { await runHook(hook, ctx); ran++; }
    }
  }
  if (ran > 0) logger.app.info("PostToolUseHooks executados", { tool: toolName, hooksRan: ran });
}
