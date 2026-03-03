#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./App.tsx";
import { loadSession, listSessions } from "./lib/session.ts";
import { MODELS, DEFAULT_MODEL } from "./lib/models.ts";
import { loadSettings, validateSettings } from "./lib/settings.ts";

// ─── CLI arg parsing ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(flag: string): string | null {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i === -1) return null;
  const arg = args[i]!;
  if (arg.includes("=")) return arg.split("=")[1] ?? null;
  return args[i + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return args.some((a) => a === flag);
}

// ─── Pre-render commands ────────────────────────────────────────────────────

// --help / -h
if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`
Sofik AI — assistente de IA interativo para terminal

Uso: sofik [opções] [prompt]

Opções:
  --model <nome>        Iniciar com um modelo específico (padrão: ${DEFAULT_MODEL})
  --resume <id>         Retomar uma sessão anterior pelo ID
  --continue, -c        Retomar a sessão mais recente do diretório atual
  --auto                Iniciar no modo de aprovação automática (pular todas as confirmações)
  --accept-edits        Iniciar no modo acceptEdits (aprovar edições de arquivos, confirmar Bash)
  --plan                Iniciar no modo de planejamento (apenas explorar, sem alterações até aprovação)
  --print <prompt>, -p  Executar um prompt único sem interação e sair
  --help                Mostrar esta ajuda

Slash commands (dentro do chat):
  /integrations status|list|connect <provider>|disconnect <provider>
  /sessions [--search <query>]
  /skill list|new|edit <nome>|remove <nome>
  /tasks list|create|run|cancel <id>|clear
  /model [nome]         Trocar o modelo
  /plan                 Entrar no modo de planejamento
  /mcp                  Ver status dos servidores MCP
  /commit               Criar um commit git
  /login                Autenticar via OAuth
  /clear                Limpar conversa atual

Modelos disponíveis:
${Object.entries(MODELS)
    .map(([id, info]) => `  ${id.padEnd(28)} — ${info.label}`)
    .join("\n")}

Modos de permissão:
  ask          (padrão) Perguntar antes de executar Bash, Write, Edit
  auto         Aprovar tudo automaticamente — use com cautela
  plan         Exploração somente leitura; sem alterações até o plano ser aprovado

Configurações:
  ~/.sofik/settings.json            Configurações do usuário
  .sofik/settings.json              Configurações do projeto
  .sofik/settings.local.json        Configurações locais (não rastreadas)

Habilidades:
  ~/.sofik/skills/*.md              Habilidades do usuário
  .sofik/skills/*.md                Habilidades do projeto
  .sofik/commands/*.md              Comandos slash personalizados

Exemplos:
  sofik
  sofik --model claude-opus-4-6
  sofik --accept-edits
  sofik --plan
  sofik --resume session-1234567890-abc123
  sofik --continue
  sofik -c
  sofik --auto "refatorar o módulo de autenticação"
  sofik --print "explique este código"
  sofik -p "quais arquivos estão em src/"
  sofik "listar todos os arquivos TypeScript"
`);
  process.exit(0);
}

// ─── Mode flags ─────────────────────────────────────────────────────────────

// Load settings to get defaultMode (user/project settings.json)
const settings = loadSettings();
const settingsErrors = validateSettings(settings);
if (settingsErrors.length > 0) {
  console.warn("Aviso: problemas encontrados nas configurações:");
  for (const err of settingsErrors) console.warn(`  • ${err}`);
  console.warn("");
}
const defaultModeFromSettings = settings.defaultMode;

// Determine initial permission mode (CLI flags override settings)
type InitialMode = "ask" | "auto" | "plan" | "acceptEdits";

let initialMode: InitialMode = "ask";

if (hasFlag("--auto")) initialMode = "auto";
else if (hasFlag("--accept-edits")) initialMode = "acceptEdits";
else if (hasFlag("--plan")) initialMode = "plan";
else if (defaultModeFromSettings === "auto" || defaultModeFromSettings === "bypassPermissions") initialMode = "auto";
else if (defaultModeFromSettings === "plan") initialMode = "plan";

// ─── Model flag ──────────────────────────────────────────────────────────────

const modelFlag = getFlag("--model");
const modelFromSettings = settings.model;
const modelOverride = modelFlag ?? modelFromSettings ?? DEFAULT_MODEL;

if (modelFlag && !MODELS[modelFlag]) {
  console.warn(
    `Aviso: o modelo "${modelFlag}" não está na lista de modelos conhecidos. Continuando assim mesmo.`
  );
}

// ─── Resume session ──────────────────────────────────────────────────────────

const resumeId = getFlag("--resume");
let initialSession = undefined;
if (resumeId) {
  initialSession = loadSession(resumeId) ?? undefined;
  if (!initialSession) {
    console.error(`Sessão "${resumeId}" não encontrada.`);
    process.exit(1);
  }
  console.log(
    `Retomando sessão: ${resumeId} (${initialSession.messages.length} mensagens)`
  );
}

// --continue / -c: resume most recent session for current cwd
if (!initialSession && (hasFlag("--continue") || hasFlag("-c"))) {
  const cwdSessions = listSessions().filter((s) => s.cwd === process.cwd());
  if (cwdSessions.length > 0) {
    const latest = cwdSessions[0]!; // listSessions() is already sorted by updatedAt desc
    initialSession = loadSession(latest.id) ?? undefined;
    if (initialSession) {
      console.log(`Retomando sessão: ${latest.id} (${initialSession.messages.length} mensagens)`);
    }
  }
}

// ─── Load MCP tools ──────────────────────────────────────────────────────────

import { loadMcpTools, disposeMcpClients } from "./lib/mcp.ts";
import { registerTool } from "./tools/index.ts";

const mcpTools = await loadMcpTools();
for (const tool of mcpTools) registerTool(tool);
if (mcpTools.length > 0) {
  console.log(`${mcpTools.length} ferramenta(s) MCP carregada(s).`);
}

process.on("exit", disposeMcpClients);
process.on("SIGINT", () => { disposeMcpClients(); process.exit(0); });
process.on("SIGTERM", () => { disposeMcpClients(); process.exit(0); });

// ─── Non-interactive mode ─────────────────────────────────────────────────────

// --print / -p or positional argument: single-prompt non-interactive mode
const positionalArgs = args.filter((a) => !a.startsWith("-"));
const printFlag = getFlag("--print") ?? getFlag("-p");
const printPrompt = printFlag ?? positionalArgs[0];

if (printPrompt) {
  const { runOnce } = await import("./lib/run.ts");
  await runOnce(printPrompt);
  process.exit(0);
}

// ─── Start UI ─────────────────────────────────────────────────────────────────

// Clear screen
process.stdout.write("\x1Bc");

render(
  <App
    initialSession={initialSession}
    modelOverride={modelOverride}
    initialMode={initialMode}
  />,
  { exitOnCtrlC: true }
);
