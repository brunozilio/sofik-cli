import fs from "fs";
import { execSync } from "child_process";
import { getSlashCommands } from "./commands.ts";
import { listSessions as listSessionFiles, searchSessions } from "./session.ts";
import { loadSkills, getSkill, invalidateSkillsCache } from "./skills.ts";
import { getMcpStatus } from "./mcp.ts";
import { login, logout, loginCopilot } from "./oauth.ts";
import { type PermissionMode } from "./permissions.ts";
import { resetSessionUsage } from "./anthropic.ts";
import {
  saveCredentials,
  listConnectedProviders,
  disconnectProvider,
} from "../integrations/CredentialStore.ts";
import { getAllProviders, getConnector } from "../integrations/connectors/index.ts";
import {
  listTasks,
  cancelTask,
  clearCompletedTasks,
} from "../db/queries/tasks.ts";
import type { Message } from "./types.ts";
import type { Session } from "./session.ts";
import type { LoginProvider } from "../components/LoginProviderSelector.tsx";

// ─── Deps interface ──────────────────────────────────────────────────────────

export interface SlashHandlerDeps {
  messages: Message[];
  session: { current: Session };
  exit: () => void;
  runAI: (msgs: Message[]) => Promise<Message[]>;
  changeModel: (id: string) => void;
  runTaskQueue: () => Promise<void>;
  startTaskPlanning: (ctx: string) => void;
  setMessages: (msgs: Message[]) => void;
  setSystemMessage: (msg: string | null) => void;
  setShowModelSelector: (v: boolean) => void;
  setShowSessionSelector: (v: boolean) => void;
  setShowIntegrationSelector: (v: boolean) => void;
  setSessionList: (v: ReturnType<typeof listSessionFiles>) => void;
  setPendingLoginResolve: (v: ((p: LoginProvider | null) => void) | null) => void;
  setPendingIntegrationConnect: (v: string | null) => void;
  setPendingTaskCreate: (v: boolean) => void;
  changeMode: (mode: PermissionMode) => void;
  resetSessionUsage: () => void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSlashHandler(deps: SlashHandlerDeps) {
  return async function handleSlashCommand(cmd: string): Promise<boolean> {
    const {
      messages,
      session,
      exit,
      runAI,
      changeModel,
      runTaskQueue,
      startTaskPlanning,
      setMessages,
      setSystemMessage,
      setShowModelSelector,
      setShowSessionSelector,
      setShowIntegrationSelector,
      setSessionList,
      setPendingLoginResolve,
      setPendingIntegrationConnect,
      setPendingTaskCreate,
      changeMode,
      resetSessionUsage,
    } = deps;

    const parts = cmd.slice(1).trim().split(/\s+/);
    const command = parts[0]?.toLowerCase() ?? "";

    // Check custom commands first
    const customCmds = getSlashCommands().filter((c) => c.isCustom);
    const customCmd = customCmds.find((c) => c.name === command);
    if (customCmd) {
      const prompt = `Execute o comando personalizado '/${command}' com estas instruções:\n\n${customCmd.description}`;
      const newMsgs: Message[] = [...messages, { role: "user", content: prompt }];
      setMessages(newMsgs);
      session.current.messages = newMsgs;
      await runAI(newMsgs);
      return true;
    }

    switch (command) {
      case "clear":
      case "reset":
      case "new": {
        setMessages([]);
        session.current.messages = [];
        resetSessionUsage();
        setSystemMessage("Conversa limpa.");
        return true;
      }

      case "model": {
        const name = parts[1];
        if (!name) {
          setShowModelSelector(true);
        } else {
          changeModel(name);
          session.current.model = name;
          setSystemMessage(`Modelo alterado para: ${name}`);
        }
        return true;
      }

      case "exit":
      case "quit": {
        exit();
        return true;
      }

      case "login": {
        // Show provider selector and wait for user choice
        const provider = await new Promise<LoginProvider | null>((resolve) => {
          setPendingLoginResolve(() => resolve);
        });
        setPendingLoginResolve(null);

        if (!provider) return true; // cancelled

        if (provider === "anthropic") {
          setSystemMessage("Iniciando autenticação Anthropic…");
          try {
            const token = await login((url, ssh) => {
              if (ssh) {
                setSystemMessage(
                  `Sessão SSH detectada — abra o link abaixo no seu navegador local:\n\n` +
                  `${url}\n\n` +
                  `Para que o callback funcione, execute no seu computador local antes de abrir o link:\n` +
                  `  ssh -L 54321:localhost:54321 SEU_SERVIDOR\n\n` +
                  `Aguardando autorização…`
                );
              } else {
                setSystemMessage(`Navegador aberto. Aguardando autorização…\n\nSe não abrir automaticamente:\n${url}`);
              }
            });
            setSystemMessage(
              `Login realizado com sucesso.\n  Escopos: ${token.scope ?? "user:profile user:inference"}`
            );
          } catch (err) {
            setSystemMessage(
              `Falha no login: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else if (provider === "copilot") {
          setSystemMessage("Aguardando autorização do GitHub…");
          try {
            const token = await loginCopilot((userCode, uri) => {
              setSystemMessage(
                `Acesse: ${uri}\nDigite o código: ${userCode}\n\nAguardando autorização…`
              );
            });
            setSystemMessage(`Login realizado no GitHub Copilot.\n  Escopo: ${token.scope}`);
          } catch (err) {
            setSystemMessage(
              `Falha no login do GitHub: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        return true;
      }

      case "logout": {
        logout();
        setSystemMessage("Desconectado. Execute '/login' ou 'sofik --login' para autenticar novamente.");
        return true;
      }

      case "sessions": {
        const searchFlag = parts.indexOf("--search");
        const query = searchFlag !== -1 ? parts.slice(searchFlag + 1).join(" ").trim() : "";

        if (query) {
          const results = searchSessions(query);
          if (results.length === 0) {
            setSystemMessage(`Nenhuma sessão encontrada para: "${query}"`);
            return true;
          }
          setSessionList(results.slice(0, 20));
          setShowSessionSelector(true);
          setSystemMessage(`${results.length} sessão(ões) encontrada(s) para: "${query}"`);
          return true;
        }

        const sessions = listSessionFiles();
        if (sessions.length === 0) {
          setSystemMessage("Nenhuma sessão salva encontrada.");
          return true;
        }
        setSessionList(sessions.slice(0, 20));
        setShowSessionSelector(true);
        return true;
      }

      case "commit": {
        const prompt =
          "Crie um commit git para as alterações atuais. Verifique git status e git diff --staged " +
          "para entender o que está em stage. Se nada estiver em stage, use git diff para ver as alterações. " +
          "Escreva uma mensagem de commit clara e convencional e crie o commit.";
        const commitMsgs: Message[] = [...messages, { role: "user", content: prompt }];
        setMessages(commitMsgs);
        session.current.messages = commitMsgs;
        await runAI(commitMsgs);
        return true;
      }

      case "plan": {
        changeMode("plan");
        session.current.messages;
        const planPrompt =
          "Você está agora no modo de planejamento. Explore o código detalhadamente usando Read, Glob, Grep, " +
          "WebFetch e WebSearch. Crie um plano de implementação detalhado usando TaskCreate para rastrear as etapas. " +
          "Quando terminar, chame ExitPlanMode para apresentar o plano para aprovação. " +
          "NÃO escreva nenhum arquivo nem execute nenhum comando até que o plano seja aprovado.";
        setSystemMessage("Modo de planejamento ativado. O Sofik AI vai explorar e planejar antes de executar.");
        const planMsgs: Message[] = [...messages, { role: "user", content: planPrompt }];
        setMessages(planMsgs);
        session.current.messages = planMsgs;
        await runAI(planMsgs);
        return true;
      }

      case "worktree": {
        const wtName = parts.slice(1).join("-") || "";
        const prompt = `Por favor, crie um git worktree isolado${wtName ? ` chamado '${wtName}'` : ""} usando a ferramenta EnterWorktree.`;
        const wtMsgs: Message[] = [...messages, { role: "user", content: prompt }];
        setMessages(wtMsgs);
        session.current.messages = wtMsgs;
        await runAI(wtMsgs);
        return true;
      }

      case "integrations": {
        const sub = parts[1]?.toLowerCase();
        const provider = parts[2]?.toLowerCase();

        if (!sub) {
          setShowIntegrationSelector(true);
          return true;
        }

        if (sub === "status") {
          const connected = listConnectedProviders();
          const allProviders = getAllProviders();
          const lines: string[] = ["Status das integrações:\n"];
          for (const p of allProviders) {
            const conn = connected.find((c) => c.provider === p);
            const connector = getConnector(p);
            const name = connector?.definition.name ?? p;
            lines.push(conn ? `  ✓ ${name} (${p}) — conectado` : `  ✗ ${name} (${p}) — não conectado`);
          }
          if (connected.length === 0) {
            lines.push("\nNenhuma integração conectada. Use /integrations connect <provider>");
          }
          setSystemMessage(lines.join("\n"));
          return true;
        }

        if (sub === "list") {
          const allProviders = getAllProviders();
          const connected = listConnectedProviders();
          const connectedSet = new Set(connected.map((c) => c.provider));
          const lines: string[] = ["Integrações disponíveis:\n"];
          for (const p of allProviders) {
            const connector = getConnector(p);
            if (!connector) continue;
            const status = connectedSet.has(p) ? "✓" : "✗";
            lines.push(`  ${status} ${connector.definition.name} (${p}) — ${connector.definition.authType}`);
            if (connectedSet.has(p)) {
              for (const action of connector.definition.actions) {
                lines.push(`      • ${action.name}: ${action.description}`);
              }
            }
          }
          setSystemMessage(lines.join("\n"));
          return true;
        }

        if (sub === "connect") {
          if (!provider) {
            const allProviders = getAllProviders().join(", ");
            setSystemMessage(`Uso: /integrations connect <provider>\nDisponíveis: ${allProviders}`);
            return true;
          }
          const connector = getConnector(provider);
          if (!connector) {
            setSystemMessage(`Provedor desconhecido "${provider}". Disponíveis: ${getAllProviders().join(", ")}`);
            return true;
          }
          // Inline API key: /integration connect github <apikey>
          const inlineKey = parts[3];
          if (inlineKey) {
            saveCredentials(provider, { apiKey: inlineKey }, connector.definition.name);
            setSystemMessage(`✓ ${connector.definition.name} conectado com sucesso.`);
            return true;
          }
          // Prompt mode: intercept next input
          setPendingIntegrationConnect(provider);
          setSystemMessage(
            `Digite a chave de API para ${connector.definition.name} (${provider}):\n(Sua entrada será salva como chave de API e removida da tela)`
          );
          return true;
        }

        if (sub === "disconnect") {
          if (!provider) {
            setSystemMessage("Uso: /integrations disconnect <provider>");
            return true;
          }
          disconnectProvider(provider);
          setSystemMessage(`${provider} desconectado.`);
          return true;
        }

        setSystemMessage(
          "Uso:\n  /integrations status\n  /integrations list\n  /integrations connect <provider> [api_key]\n  /integrations disconnect <provider>"
        );
        return true;
      }

      case "tasks": {
        // Job Queue — persistent SQLite queue for autonomous background jobs
        const sub = parts[1]?.toLowerCase();
        const taskId = parts[2];

        if (!sub || sub === "list") {
          const allTasks = listTasks();
          if (allTasks.length === 0) {
            setSystemMessage("Nenhuma tarefa na fila de jobs. Use /tasks create para adicionar.");
            return true;
          }
          const STATUS_ICON: Record<string, string> = {
            planning: "✎",
            pending: "⏳",
            running: "▶",
            done: "✓",
            failed: "✗",
            cancelled: "⊘",
          };
          const lines = [`Fila de Jobs (${allTasks.length}):\n`];
          for (const t of allTasks) {
            const icon = STATUS_ICON[t.status] ?? "?";
            const short = t.id.slice(0, 8);
            const ctx = t.context.length > 60 ? t.context.slice(0, 57) + "..." : t.context;
            lines.push(`  [${short}] ${icon} ${t.status.padEnd(9)} — ${ctx}`);
          }
          setSystemMessage(lines.join("\n"));
          return true;
        }

        if (sub === "create") {
          const inlineContext = parts.slice(2).join(" ").trim();
          if (inlineContext) {
            startTaskPlanning(inlineContext);
            return true;
          }
          setPendingTaskCreate(true);
          setSystemMessage("Digite o contexto do job (o que o agente deve fazer autonomamente?):");
          return true;
        }

        if (sub === "run") {
          runTaskQueue();
          return true;
        }

        if (sub === "cancel") {
          if (!taskId) {
            setSystemMessage("Uso: /tasks cancel <id>");
            return true;
          }
          const cancelled = cancelTask(taskId);
          if (cancelled) {
            setSystemMessage(`Job [${taskId}] cancelado.`);
          } else {
            setSystemMessage(`Job [${taskId}] não encontrado ou não está pendente.`);
          }
          return true;
        }

        if (sub === "clear") {
          const count = clearCompletedTasks();
          setSystemMessage(`${count} job(s) concluído(s)/cancelado(s) removido(s).`);
          return true;
        }

        setSystemMessage(
          "Fila de Jobs:\n  /tasks — listar jobs\n  /tasks create [contexto]\n  /tasks run — executar próximo job\n  /tasks cancel <id>\n  /tasks clear"
        );
        return true;
      }

      case "skill": {
        const sub = parts[1]?.toLowerCase();

        if (!sub || sub === "list") {
          const skills = loadSkills(true);
          if (skills.length === 0) {
            setSystemMessage("Nenhuma skill disponível.\n  ~/.sofik/skills/*.md — skills do usuário\n  .sofik/skills/*.md — skills do projeto");
            return true;
          }
          const lines = [`Skills disponíveis (${skills.length}):\n`];
          for (const s of skills) {
            lines.push(`  • ${s.name} — ${s.description}`);
            if (s.triggers?.length) lines.push(`    triggers: ${s.triggers.join(", ")}`);
          }
          setSystemMessage(lines.join("\n"));
          return true;
        }

        if (sub === "new") {
          const prompt =
            "Crie uma nova skill para o Sofik. Uma skill é um arquivo Markdown em ~/.sofik/skills/ com frontmatter opcional:\n" +
            "---\ndescription: breve descrição\ntriggers: [palavra1, palavra2]\n---\n# Conteúdo da skill...\n\n" +
            "Pergunte ao usuário: nome da skill, descrição, triggers (opcionais), e o conteúdo/template. " +
            "Depois crie o arquivo usando Write em ~/.sofik/skills/<nome>.md";
          const skillMsgs: Message[] = [...messages, { role: "user", content: prompt }];
          setMessages(skillMsgs);
          session.current.messages = skillMsgs;
          await runAI(skillMsgs);
          return true;
        }

        if (sub === "edit") {
          const name = parts.slice(2).join(" ").trim();
          if (!name) {
            setSystemMessage("Uso: /skill edit <nome>");
            return true;
          }
          const skill = getSkill(name);
          if (!skill) {
            setSystemMessage(`Skill "${name}" não encontrada. Use /skill list para ver as disponíveis.`);
            return true;
          }
          const editor = process.env.EDITOR ?? "vi";
          try {
            execSync(`${editor} "${skill.source}"`, { stdio: "inherit" });
            invalidateSkillsCache();
            setSystemMessage(`Skill "${name}" editada.`);
          } catch {
            setSystemMessage(`Erro ao abrir editor para "${skill.source}". Defina a variável EDITOR.`);
          }
          return true;
        }

        if (sub === "remove") {
          const name = parts.slice(2).join(" ").trim();
          if (!name) {
            setSystemMessage("Uso: /skill remove <nome>");
            return true;
          }
          const skill = getSkill(name);
          if (!skill) {
            setSystemMessage(`Skill "${name}" não encontrada.`);
            return true;
          }
          try {
            fs.unlinkSync(skill.source);
            invalidateSkillsCache();
            setSystemMessage(`Skill "${name}" removida.`);
          } catch (err) {
            setSystemMessage(`Erro ao remover skill: ${err instanceof Error ? err.message : String(err)}`);
          }
          return true;
        }

        setSystemMessage("Uso:\n  /skill list\n  /skill new\n  /skill edit <nome>\n  /skill remove <nome>");
        return true;
      }

      case "mcp": {
        const statuses = getMcpStatus();
        if (statuses.length === 0) {
          setSystemMessage("Nenhum servidor MCP configurado. Crie .mcp.json na raiz do projeto.");
          return true;
        }
        const lines = [`Servidores MCP (${statuses.length}):\n`];
        for (const s of statuses) {
          lines.push(`  ${s.healthy ? "✓" : "✗"} ${s.name} — ${s.healthy ? "saudável" : "falhou"}`);
        }
        setSystemMessage(lines.join("\n"));
        return true;
      }

      default:
        return false;
    }
  };
}
