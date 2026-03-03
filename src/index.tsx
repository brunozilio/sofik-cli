#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./App.tsx";
import { loadSettings, validateSettings } from "./lib/settings.ts";
import { logger } from "./lib/logger.ts";

// ─── Mode flags ─────────────────────────────────────────────────────────────

// Load settings to get defaultMode (user/project settings.json)
logger.app.info("Sofik AI iniciando", { cwd: process.cwd(), pid: process.pid, nodeVersion: process.version });

const settings = loadSettings();
const settingsErrors = validateSettings(settings);
if (settingsErrors.length > 0) {
  logger.app.warn("Problemas nas configurações encontrados", { errors: settingsErrors });
  console.warn("Aviso: problemas encontrados nas configurações:");
  for (const err of settingsErrors) console.warn(`  • ${err}`);
  console.warn("");
}

// Determine initial permission mode
type InitialMode = "ask" | "auto" | "plan" | "acceptEdits";

let initialMode: InitialMode = "ask";

// ─── Load MCP tools ──────────────────────────────────────────────────────────

import { loadMcpTools, disposeMcpClients } from "./lib/mcp.ts";
import { registerTool } from "./tools/index.ts";

const mcpTools = await loadMcpTools();
for (const tool of mcpTools) registerTool(tool);
if (mcpTools.length > 0) {
  logger.app.info("Ferramentas MCP carregadas", { count: mcpTools.length, tools: mcpTools.map(t => t.name) });
  console.log(`${mcpTools.length} ferramenta(s) MCP carregada(s).`);
}

process.on("exit", () => {
  logger.app.info("Sofik AI encerrando");
  disposeMcpClients();
});
process.on("SIGINT", () => { disposeMcpClients(); process.exit(0); });
process.on("SIGTERM", () => { disposeMcpClients(); process.exit(0); });

// ─── Non-interactive mode ─────────────────────────────────────────────────────

// ─── Start UI ─────────────────────────────────────────────────────────────────

// Clear screen
process.stdout.write("\x1Bc");

render(
  <App
    initialMode={initialMode}
  />,
  { exitOnCtrlC: true }
);
