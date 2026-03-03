import { loadCustomCommands } from "./skills.ts";
import { getAllConnectors, getAllProviders } from "../integrations/connectors/index.ts";
import { MODELS, COPILOT_MODELS } from "./models.ts";
import { listTasks } from "../db/queries/tasks.ts";

export type CommandArg = { name: string; description?: string };
export type CommandArgs = CommandArg[] | (() => CommandArg[]);

export interface SlashSubCommand {
  name: string;
  description: string;
  args?: CommandArgs;
}

export interface SlashCommand {
  name: string;
  description: string;
  isCustom?: boolean;
  subcommands?: SlashSubCommand[];
  args?: CommandArgs;
}

const integrationArgs = getAllProviders().map((p) => ({
  name: p,
  description: getAllConnectors().find((c) => c.definition.provider === p)?.definition.name,
}));

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "clear",      description: "Limpar o histórico da conversa (aliases: reset, new)" },
  { name: "commit",     description: "Criar um commit git (assistido por IA)" },
  { name: "exit",       description: "Sair do REPL (alias: quit)" },
  { name: "login",      description: "Entrar com sua conta" },
  { name: "logout",     description: "Sair da sua conta" },
  {
    name: "model",
    description: "Mostrar ou trocar o modelo",
    args: [
      ...Object.entries(MODELS).map(([id, info]) => ({ name: id, description: info.label })),
      ...Object.entries(COPILOT_MODELS).map(([id, info]) => ({ name: id, description: info.label })),
    ],
  },
  { name: "plan",       description: "Entrar no modo de planejamento (explorar antes de executar)" },
  {
    name: "sessions",
    description: "Listar sessões recentes",
    args: [{ name: "--search", description: "Buscar sessões pelo conteúdo" }],
  },
  {
    name: "skill",
    description: "Gerenciar skills (templates de prompt)",
    subcommands: [
      { name: "list",   description: "Listar skills disponíveis" },
      { name: "new",    description: "Criar uma nova skill (wizard via IA)" },
      { name: "edit",   description: "Editar skill no $EDITOR" },
      { name: "remove", description: "Remover uma skill" },
    ],
  },
  { name: "mcp",        description: "Verificar status dos servidores MCP" },
  { name: "worktree",   description: "Criar um git worktree isolado" },
  {
    name: "tasks",
    description: "Gerenciar tarefas na fila",
    subcommands: [
      { name: "list",   description: "Listar todas as tarefas na fila" },
      { name: "create", description: "Criar uma nova tarefa" },
      { name: "run",    description: "Executar tarefas pendentes agora" },
      {
        name: "cancel",
        description: "Cancelar uma tarefa",
        args: () => {
          try {
            return listTasks()
              .filter((t) => t.status === "pending" || t.status === "planning")
              .map((t) => ({ name: t.id.slice(0, 8), description: t.context.slice(0, 60) }));
          } catch {
            return [];
          }
        },
      },
      { name: "clear",  description: "Remover todas as tarefas" },
    ],
  },
  {
    name: "integrations",
    description: "Gerenciar credenciais de integração",
    subcommands: [
      { name: "status",     description: "Mostrar status das integrações" },
      { name: "list",       description: "Listar todas as integrações" },
      { name: "connect",    description: "Conectar uma nova integração",    args: integrationArgs },
      { name: "disconnect", description: "Desconectar uma integração",    args: integrationArgs },
    ],
  },
];

/** Get all slash commands including custom ones from .sofik/commands/ */
export function getSlashCommands(): SlashCommand[] {
  const custom = loadCustomCommands().map((c) => ({
    name: c.name,
    description: c.description,
    isCustom: true,
  }));

  // Custom commands override builtins with the same name
  const byName = new Map<string, SlashCommand>();
  for (const cmd of BUILTIN_COMMANDS) byName.set(cmd.name, cmd);
  for (const cmd of custom) byName.set(cmd.name, cmd);

  return Array.from(byName.values());
}

/** Legacy export for components that just need the list at import time */
export const SLASH_COMMANDS: SlashCommand[] = BUILTIN_COMMANDS;
