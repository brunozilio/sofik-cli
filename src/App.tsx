import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { Chat } from "./components/Chat.tsx";
import { Input } from "./components/Input.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { PermissionPrompt } from "./components/PermissionPrompt.tsx";
import { ModelSelector } from "./components/ModelSelector.tsx";
import { SessionSelector } from "./components/SessionSelector.tsx";
import { IntegrationSelector } from "./components/IntegrationSelector.tsx";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import {
  createClient,
  streamResponse,
  shouldCompact,
  compact,
  microcompact,
  getCurrentModel,
  setModel,
  getSessionUsage,
  resetSessionUsage,
  estimateCost,
} from "./lib/anthropic.ts";
import { getAllTools, getTool } from "./tools/index.ts";
import { listModels, getModel } from "./lib/models.ts";
import { getSlashCommands, BUILTIN_COMMANDS } from "./lib/commands.ts";
import { saveSession, listSessions as listSessionFiles, loadSession } from "./lib/session.ts";
import {
  checkPermission,
  approve,
  approveAll,
  getPermissionMode,
  setPermissionMode,
  type PermissionMode,
} from "./lib/permissions.ts";
import { login, logout, loginCopilot } from "./lib/oauth.ts";
import { LoginProviderSelector, type LoginProvider } from "./components/LoginProviderSelector.tsx";
import { getActiveTasks, onTasksChange } from "./tools/task.ts";
import { onExitPlanMode, type PlanApprovalRequest } from "./tools/planMode.ts";
import { onAskUser, type AskUserRequest } from "./tools/askUser.ts";
import { QuestionPrompt } from "./components/QuestionPrompt.tsx";
import { detectPromptInjection } from "./lib/injection.ts";
import { saveProjectSettings } from "./lib/settings.ts";
import { loadSkills } from "./lib/skills.ts";
import { sendNotification } from "./lib/notifications.ts";
import type { Message, AgentStatus, TurnEvent } from "./lib/types.ts";
import type { Session } from "./lib/session.ts";
import {
  saveCredentials,
  listConnectedProviders,
  disconnectProvider,
  isConnected,
} from "./integrations/CredentialStore.ts";
import { getAllProviders, getConnector } from "./integrations/connectors/index.ts";
import {
  createTask,
  listTasks,
  getNextPendingTask,
  updateTaskStatus,
  updateTaskPlan,
  cancelTask,
  clearCompletedTasks,
} from "./db/queries/tasks.ts";
import { createSlashHandler } from "./lib/slash-handler.ts";
import { createJobQueueRunner } from "./lib/job-queue-runner.ts";
import { logger } from "./lib/logger.ts";
import { onBackgroundTaskComplete } from "./lib/backgroundTasks.ts";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

// ─── Module-level singletons ───────────────────────────────────────────────

// Lazily initialized to avoid crashing on --help / --sessions
let _client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!_client) _client = createClient();
  return _client;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as ReturnType<typeof createClient>;

const tools = getAllTools();

// ─── @mention expansion ───────────────────────────────────────────────────────

async function expandMentions(text: string): Promise<string> {
  const mentionRegex = /@([\w./\\-]+)/g;
  const matches = [...text.matchAll(mentionRegex)];
  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches) {
    const filePath = match[1]!;
    try {
      const content = await Bun.file(filePath).text();
      result = result.replace(match[0], `\`${filePath}\`:\n\`\`\`\n${content}\n\`\`\``);
    } catch { /* keep original @mention */ }
  }
  return result;
}

// ─── Thinking detection ───────────────────────────────────────────────────────

function detectThinkingBudget(text: string): number | undefined {
  if (/\bultrathink\b/gi.test(text)) return 16000;
  if (/\bthink(?:ing)?\b/gi.test(text)) return 5000;
  return undefined;
}

// ─── App ───────────────────────────────────────────────────────────────────

interface AppProps {
  initialSession?: Session;
  modelOverride?: string;
  initialMode?: "ask" | "auto" | "plan" | "acceptEdits";
}

const MODE_COLORS: Record<string, string> = {
  ask: "green",
  acceptEdits: "cyan",
  auto: "yellow",
  bypassPermissions: "yellow",
  plan: "blue",
};

export function App({ initialSession, modelOverride, initialMode }: AppProps) {
  const { exit } = useApp();

  const abortControllerRef = useRef<AbortController | null>(null);

  const session = useRef<Session>(
    initialSession ?? {
      id: `session-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: getCurrentModel(),
      cwd: process.cwd(),
      messages: [],
    }
  );

  // Register current session ID with logger so all log entries are correlated
  React.useEffect(() => {
    logger.setSession(session.current.id);
    logger.app.info("Sessão de app iniciada", {
      sessionId: session.current.id,
      model: session.current.model,
      cwd: session.current.cwd,
      resumed: !!initialSession,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { internal_eventEmitter } = useStdin();
  const [messages, setMessages] = useState<Message[]>(initialSession?.messages ?? []);
  const [turnEvents, setTurnEvents] = useState<TurnEvent[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [statusLabel, setStatusLabel] = useState("");
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [activeTasks, setActiveTasks] = useState(getActiveTasks());
  const [permMode, setPermModeState] = useState<PermissionMode>(
    initialMode ?? getPermissionMode()
  );
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [showIntegrationSelector, setShowIntegrationSelector] = useState(false);
  const [sessionList, setSessionList] = useState<ReturnType<typeof listSessionFiles>>([]);
  const [currentModelState, setCurrentModelState] = useState(() => {
    const initial = modelOverride ?? getCurrentModel();
    if (modelOverride) setModel(modelOverride);
    return initial;
  });
  const [pendingLoginResolve, setPendingLoginResolve] = useState<((p: LoginProvider | null) => void) | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<AskUserRequest | null>(null);
  const [pendingIntegrationConnect, setPendingIntegrationConnect] = useState<string | null>(null);
  const [pendingTaskCreate, setPendingTaskCreate] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState<number | undefined>(undefined);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  // Track last input tokens for smart compaction
  const lastInputTokensRef = useRef<number | undefined>(undefined);
  // Always-current ref so the queue runner reads fresh messages after each AI turn
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const changeModel = useCallback((modelId: string) => {
    setModel(modelId);
    setCurrentModelState(modelId);
    saveProjectSettings({ model: modelId });
  }, []);

  const changeMode = useCallback((mode: PermissionMode) => {
    setPermissionMode(mode);
    setPermModeState(mode);
  }, []);

  // Plan mode state
  const [pendingPlanApproval, setPendingPlanApproval] =
    useState<PlanApprovalRequest | null>(null);

  // Refresh active tasks whenever they change
  useEffect(() => {
    const unsub = onTasksChange(() => setActiveTasks(getActiveTasks()));
    return unsub;
  }, []);

  // Register plan mode exit handler
  useEffect(() => {
    onExitPlanMode((req) => {
      setPendingPlanApproval(req);
    });
  }, []);

  // Register AskUserQuestion handler
  useEffect(() => {
    onAskUser((req) => {
      setPendingQuestion(req);
    });
  }, []);

  // Notify when background tasks complete
  useEffect(() => {
    const unsub = onBackgroundTaskComplete((task) => {
      const icon = task.status === "completed" ? "✓" : "✗";
      const statusText = task.status === "completed" ? "completed" : task.status === "stopped" ? "stopped" : "failed";
      const msg = `${icon} Background task '${task.description}' ${statusText}.`;
      setSystemMessage(msg);
      sendNotification("Sofik AI", msg);
    });
    return unsub;
  }, []);

  // ─── Permission prompt ───────────────────────────────────────────────────

  const askPermission = useCallback(
    (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
      return new Promise((resolve) => {
        setPendingPermission({ toolName, input, resolve });
      });
    },
    []
  );

  // ─── Core AI runner ──────────────────────────────────────────────────────

  const runAI = useCallback(
    async (msgs: Message[]): Promise<Message[]> => {
      const requestId = crypto.randomUUID();
      logger.setRequest(requestId);
      logger.app.info("runAI iniciado", { messageCount: msgs.length, model: getCurrentModel() });
      setStatus("thinking");
      setStatusLabel("");

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let fullText = "";
      let resultMessages: Message[] = msgs;

      // Turn event list: text segments interleaved with tool calls/results
      const evts: TurnEvent[] = [];
      let currentText = "";

      const flushText = () => {
        if (currentText.trim()) {
          evts.push({ type: "text", text: currentText });
          currentText = "";
        }
      };

      // Capture thinking budget for this run, then reset
      const budget = thinkingBudget;
      if (budget) setThinkingBudget(undefined);

      const turnStart = Date.now();

      try {
        const stream = streamResponse(
          client,
          msgs,
          tools,
          async (toolName, input) => {
            const inp = input as Record<string, unknown>;
            setStatus("tool_use");
            setStatusLabel(`⏺ ${toolName}`);

            // Check permission
            const decision = checkPermission(toolName, inp);

            if (decision === "deny") {
              const mode = getPermissionMode();
              const reason =
                mode === "plan"
                  ? `${toolName} não está disponível no modo de planejamento. Use EnterPlanMode/ExitPlanMode para planejar primeiro.`
                  : `${toolName} negado pelas regras de permissão em settings.json.`;
              logger.permission.warn("Ferramenta negada", { tool: toolName, mode, reason });
              throw new Error(reason);
            }

            if (decision === "ask") {
              logger.permission.info("Aguardando aprovação do usuário", { tool: toolName });
              const allowed = await askPermission(toolName, inp);
              setPendingPermission(null);
              if (!allowed) {
                logger.permission.warn("Usuário negou ferramenta", { tool: toolName });
                throw new Error(`Usuário negou permissão para ${toolName}`);
              }
              logger.permission.info("Usuário aprovou ferramenta", { tool: toolName });
              approve(toolName, inp);
            } else if (decision === "allow") {
              logger.permission.debug("Ferramenta permitida automaticamente", { tool: toolName });
            }

            flushText();
            evts.push({ type: "tool_use", name: toolName, input: inp });
            setTurnEvents([...evts]);
          },
          (toolResult) => {
            setStatus("thinking");
            setStatusLabel("");

            // Detect prompt injection in tool results
            const injectionWarning = detectPromptInjection(toolResult.content);

            evts.push({
              type: "tool_result",
              result: toolResult.content,
              is_error: toolResult.is_error,
              injectionWarning: injectionWarning ?? undefined,
            });
            setTurnEvents([...evts]);
          },
          abortController.signal,
          {
            thinkingBudget: budget,
            onUsageUpdate: (inputTokens) => {
              lastInputTokensRef.current = inputTokens;
            },
            onThinking: (thinkingText) => {
              evts.push({ type: "thinking", text: thinkingText });
              setTurnEvents([...evts]);
            },
          }
        );

        setStatus("responding");
        let lastRender = 0;
        for await (const chunk of stream) {
          fullText += chunk;
          currentText += chunk;
          const now = Date.now();
          if (now - lastRender > 100) {
            setTurnEvents([...evts, { type: "text", text: currentText }]);
            lastRender = now;
          }
        }

        // Garantir render final com todo o texto acumulado
        if (currentText) {
          setTurnEvents([...evts, { type: "text", text: currentText }]);
        }

        flushText();

        const durationMs = Date.now() - turnStart;
        const usage = getSessionUsage();
        const costUSD = estimateCost(getCurrentModel(), usage);

        const assistantMsg: Message = {
          role: "assistant",
          content: fullText,
          id: crypto.randomUUID(),
          durationMs,
          costUSD,
        };

        resultMessages = [
          ...msgs,
          assistantMsg,
        ];
        setMessages(resultMessages);
        session.current.messages = resultMessages;
        saveSession(session.current);
        setTurnEvents([]);
        logger.app.info("runAI concluído", { totalMessages: resultMessages.length, responseLength: fullText.length, durationMs, response: fullText.slice(0, 3000) });
      } catch (err) {
        const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"));
        if (!isAbort) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.app.error("runAI erro", { error: errMsg, isAbort: false });
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${errMsg}` },
          ]);
        } else {
          logger.app.info("runAI abortado pelo usuário", { hadPartialResponse: !!fullText.trim() });
          if (fullText.trim()) {
            // Keep partial response on abort
            setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
          }
        }
        setTurnEvents([]);
        setPendingPermission(null);
      } finally {
        abortControllerRef.current = null;
        logger.setRequest(undefined);
        logger.setTurn(undefined);
        logger.setToolCall(undefined);
      }

      setStatus("idle");
      setStatusLabel("");
      return resultMessages;
    },
    [askPermission, thinkingBudget]
  );

  // ─── Job queue runner (worktree + task planning + queue execution) ────────

  const jobQueueRunnerRef = useRef(
    createJobQueueRunner({
      messagesRef,
      session,
      setMessages,
      setTurnEvents,
      setSystemMessage,
      runAI,
      changeMode,
      abortControllerRef,
    })
  );

  // Re-create runner when stable callbacks change (runAI, changeMode are stable useCallback refs)
  useEffect(() => {
    jobQueueRunnerRef.current = createJobQueueRunner({
      messagesRef,
      session,
      setMessages,
      setTurnEvents,
      setSystemMessage,
      runAI,
      changeMode,
      abortControllerRef,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAI, changeMode]);

  const runTaskQueue = useCallback(async () => {
    return jobQueueRunnerRef.current.runTaskQueue();
  }, []);

  const startTaskPlanning = useCallback((context: string) => {
    jobQueueRunnerRef.current.startTaskPlanning(context);
  }, []);

  // planningTaskIdRef lives inside the runner; expose it for the plan approval handler
  const planningTaskIdRef = jobQueueRunnerRef.current.planningTaskIdRef;

  // ─── Plan approval keyboard handler ─────────────────────────────────────

  useInput(
    (input) => {
      if (!pendingPlanApproval) return;
      if (input === "y" || input === "Y") {
        const req = pendingPlanApproval;
        setPendingPlanApproval(null);

        if (planningTaskIdRef.current) {
          // Task planning mode: store plan, queue task, then execute
          const taskId = planningTaskIdRef.current;
          planningTaskIdRef.current = null;
          if (req.planContent) updateTaskPlan(taskId, req.planContent);
          updateTaskStatus(taskId, "pending");
          changeMode("ask");
          logger.app.info("Plano aprovado pelo usuário", { taskId, hasPlanContent: !!req.planContent });
          req.resolve(true);
          // Abort the planning conversation; execution starts fresh via queue
          setTimeout(() => {
            abortControllerRef.current?.abort();
            setTimeout(() => runTaskQueue(), 150);
          }, 10);
        } else {
          changeMode("ask"); // Exit plan mode after approval
          logger.app.info("Plano aprovado pelo usuário (sem tarefa)");
          req.resolve(true);
        }
      } else if (input === "n" || input === "N") {
        const req = pendingPlanApproval;
        setPendingPlanApproval(null);
        logger.app.info("Plano rejeitado pelo usuário");
        req.resolve(false);
      }
    },
    { isActive: pendingPlanApproval !== null }
  );

  // Esc: cancel current AI execution
  useInput(
    (_, key) => {
      if (key.escape && abortControllerRef.current) {
        abortControllerRef.current.abort();
        setSystemMessage("Interrompido.");
      }
    },
    { isActive: status !== "idle" }
  );

  // Shift+Tab: cycle permission mode (ask → plan → auto → ask)
  // Handles both \x1b[Z (xterm/VT100) and \x1b\t (some SSH terminals on Linux).
  useEffect(() => {
    if (status !== "idle") return;
    const handler = (input: string) => {
      if (input === "\x1b[Z" || input === "\x1b\t") {
        const modes = ["ask", "plan", "auto"] as const;
        const idx = modes.indexOf(permMode as "ask" | "plan" | "auto");
        const next = modes[(idx + 1) % modes.length] as PermissionMode;
        changeMode(next);
      }
    };
    internal_eventEmitter.on("input", handler);
    return () => { internal_eventEmitter.off("input", handler); };
  }, [status, permMode, changeMode, internal_eventEmitter]);

  // ─── Slash command handler ────────────────────────────────────────────────

  const handleSlashCommand = useCallback(
    async (cmd: string): Promise<boolean> => {
      return createSlashHandler({
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
        setThinkingBudget,
        setShowConfigPanel,
        currentModel: getCurrentModel(),
        lastInputTokens: lastInputTokensRef.current,
      })(cmd);
    },
    [messages, exit, runAI, changeModel, runTaskQueue, startTaskPlanning, changeMode]
  );

  // ─── Input handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (userInput: string) => {
      if (status !== "idle") return;

      setSystemMessage(null);

      // Handle pending task create (context input)
      if (pendingTaskCreate) {
        setPendingTaskCreate(false);
        const context = userInput.trim();
        if (!context) {
          setSystemMessage("Cancelado. Nenhum contexto fornecido.");
          return;
        }
        startTaskPlanning(context);
        return;
      }

      // Handle pending integration connect (API key input)
      if (pendingIntegrationConnect) {
        const provider = pendingIntegrationConnect;
        setPendingIntegrationConnect(null);
        const apiKey = userInput.trim();
        if (!apiKey) {
          setSystemMessage("Cancelado. Nenhuma chave de API fornecida.");
          return;
        }
        const connector = getConnector(provider);
        saveCredentials(provider, { apiKey }, connector?.definition.name ?? provider);
        logger.app.info("Integração conectada", { provider });
        setSystemMessage(`✓ ${connector?.definition.name ?? provider} conectado com sucesso.`);
        return;
      }

      if (userInput.startsWith("/")) {
        logger.app.info("Comando slash recebido", { command: userInput.split(" ")[0], length: userInput.length });
        const handled = await handleSlashCommand(userInput);
        if (handled) return;
        setSystemMessage(`Comando desconhecido: ${userInput}.`);
        return;
      }

      // Expand @mentions
      const expandedInput = await expandMentions(userInput);

      logger.app.info("Mensagem do usuário recebida", { length: expandedInput.length, messageCount: messages.length, content: expandedInput.slice(0, 2000) });

      // Detect thinking keywords
      const budget = detectThinkingBudget(expandedInput);
      if (budget) setThinkingBudget(budget);

      const userMsg: Message = {
        role: "user",
        content: expandedInput,
        id: crypto.randomUUID(),
      };

      // Auto-title session from first user message
      if (messages.length === 0 && !session.current.title) {
        session.current.title = userInput.slice(0, 80);
      }

      // Apply microcompact before adding new message
      const microcompacted = microcompact(messages);
      const newMessages: Message[] = [
        ...microcompacted,
        userMsg,
      ];

      setMessages(newMessages);
      setTurnEvents([]);

      let workingMessages = newMessages;
      if (shouldCompact(workingMessages, lastInputTokensRef.current)) {
        setStatus("compacting");
        setStatusLabel("Compactando contexto…");
        try {
          workingMessages = await compact(client, workingMessages);
          setMessages(workingMessages);
          session.current.messages = workingMessages;
        } catch { /* continue without compacting */ }
      }

      await runAI(workingMessages);
    },
    [messages, status, handleSlashCommand, runAI, pendingIntegrationConnect, pendingTaskCreate, runTaskQueue]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const isThinking = status !== "idle";
  const model = currentModelState;

  // Right-side footer: mode indicator
  const modeStatus =
    permMode === "plan" && "⏸ modo plano" ||
    permMode === "auto" && "⏵⏵ bypass" ||
    permMode === "ask" && "⏵ perguntar";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Status Bar */}
      <StatusBar
        model={model}
        cwd={process.cwd()}
      />

      {/* Messages + streaming */}
      <Chat
        messages={messages}
        turnEvents={turnEvents}
        status={statusLabel}
      />

      {/* Injection warnings from tool results */}
      {turnEvents
        .filter((e) => e.injectionWarning)
        .slice(-1)
        .map((e, i) => (
          <Box
            key={i}
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
            marginY={1}
          >
            <Text color="yellow">⚠ {e.injectionWarning}</Text>
          </Box>
        ))}

      {/* Plan approval prompt */}
      {pendingPlanApproval && (
        <Box
          borderStyle="double"
          borderColor="cyan"
          paddingX={2}
          paddingY={1}
          marginY={1}
          flexDirection="column"
        >
          <Text bold color="cyan">Plano Pronto — Revise e Aprove</Text>
          {pendingPlanApproval.allowedPrompts?.length && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>Permissões necessárias:</Text>
              {pendingPlanApproval.allowedPrompts.map((p, i) => (
                <Text key={i} dimColor>  • {p.tool}: {p.prompt}</Text>
              ))}
            </Box>
          )}
          <Box marginTop={1}>
            <Text>Pressione </Text>
            <Text bold color="green">y</Text>
            <Text> para aprovar e executar, </Text>
            <Text bold color="red">n</Text>
            <Text> para rejeitar</Text>
          </Box>
        </Box>
      )}

      {/* System messages (slash command output) */}
      {systemMessage && (
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={2}
          paddingY={1}
          marginY={1}
          flexDirection="column"
        >
          <Text dimColor>{systemMessage}</Text>
        </Box>
      )}

      {/* Login provider selector */}
      {pendingLoginResolve && (
        <LoginProviderSelector
          onSelect={(provider) => pendingLoginResolve(provider)}
          onCancel={() => pendingLoginResolve(null)}
        />
      )}

      {/* Model selector */}
      {showModelSelector && (
        <ModelSelector
          currentModel={currentModelState}
          onSelect={(modelId) => {
            changeModel(modelId);
            session.current.model = modelId;
            setShowModelSelector(false);
            setSystemMessage(`Modelo alterado para: ${modelId}`);
          }}
          onCancel={() => setShowModelSelector(false)}
        />
      )}

      {/* Integration selector */}
      {showIntegrationSelector && (
        <IntegrationSelector
          onSelect={(provider) => {
            setShowIntegrationSelector(false);
            const connector = getConnector(provider);
            setPendingIntegrationConnect(provider);
            setSystemMessage(
              `Digite a chave de API para ${connector?.definition.name ?? provider} (${provider}):\n(Sua entrada será salva como chave de API e removida da tela)`
            );
          }}
          onCancel={() => setShowIntegrationSelector(false)}
        />
      )}

      {/* Session selector */}
      {showSessionSelector && (
        <SessionSelector
          sessions={sessionList}
          onSelect={(id) => {
            const loaded = loadSession(id);
            if (!loaded) {
              setShowSessionSelector(false);
              setSystemMessage(`Sessão não encontrada: ${id}`);
              return;
            }
            session.current = loaded;
            setMessages(loaded.messages);
            setTurnEvents([]);
            changeModel(loaded.model);
            setShowSessionSelector(false);
            setSystemMessage(`Sessão retomada: ${id}`);
          }}
          onCancel={() => setShowSessionSelector(false)}
        />
      )}

      {/* Config panel */}
      {showConfigPanel && (
        <ConfigPanel
          currentModel={currentModelState}
          onClose={() => setShowConfigPanel(false)}
          onModelChange={(modelId) => {
            changeModel(modelId);
            session.current.model = modelId;
          }}
        />
      )}

      {/* Question prompt */}
      {pendingQuestion && (
        <QuestionPrompt
          request={pendingQuestion}
          onComplete={(answers) => {
            setPendingQuestion(null);
            pendingQuestion.resolve(answers);
          }}
          onCancel={() => {
            setPendingQuestion(null);
            pendingQuestion.resolve({});
          }}
        />
      )}

      {/* Permission prompt */}
      {pendingPermission && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          input={pendingPermission.input}
          onApprove={() => pendingPermission.resolve(true)}
          onApproveAll={() => {
            approveAll();
            pendingPermission.resolve(true);
          }}
          onDeny={() => pendingPermission.resolve(false)}
        />
      )}

      {/* Active tasks spinner */}
      {activeTasks.length > 0 && !pendingPermission && (
        <Box flexDirection="column" marginBottom={1}>
          {activeTasks.map((t) => (
            <Spinner key={t.id} label={t.activeForm} />
          ))}
        </Box>
      )}

      {/* Spinner while processing (hidden during tool_use — running tool is shown inline in Chat) */}
      {isThinking && status !== "responding" && status !== "tool_use" && !pendingPermission && activeTasks.length === 0 && (
        <Box marginBottom={1}>
          <Spinner
            label={
              status === "compacting"
                ? "Compactando contexto…"
                : "Pensando…"
            }
          />
        </Box>
      )}

      {/* Input */}
      {!pendingPermission && !pendingPlanApproval && !showModelSelector && !showSessionSelector && !showIntegrationSelector && !pendingLoginResolve && !pendingQuestion && !showConfigPanel && (
        <Input
          onSubmit={handleSubmit}
          disabled={isThinking}
          placeholder="Aguardando Sofik…"
          commands={getSlashCommands()}
        />
      )}

      {/* Footer */}
      <Box marginTop={1} justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          <Text color={MODE_COLORS[permMode]}>{modeStatus}</Text>
          <Text dimColor>{process.platform === "darwin" ? "^C" : "Ctrl+C"} sair{isThinking ? " · esc para interromper" : ""}</Text>
          {thinkingBudget && <Text color="cyan"> · 💭 thinking</Text>}
        </Box>

        <Box flexDirection="row" gap={1}>
          {(() => {
            const u = getSessionUsage();
            const total = u.inputTokens + u.cacheReadTokens;
            const ctx = getModel(model).contextWindow;
            const pct = Math.min(100, Math.round((total / ctx) * 100));
            const bar = "█".repeat(Math.round((pct / 100) * 10)) + "░".repeat(10 - Math.round((pct / 100) * 10));
            const cost = estimateCost(model, u);
            return total > 0 ? (
              <>
                <Text dimColor>
                  {u.inputTokens > 0 ? `${(u.inputTokens / 1000).toFixed(1)}k in` : ""}
                  {u.outputTokens > 0 ? ` · ${(u.outputTokens / 1000).toFixed(1)}k out` : ""}
                  {cost > 0 ? ` · $${cost.toFixed(4)}` : ""}
                </Text>
                <Text dimColor>│</Text>
                <Text color={pct > 80 ? "red" : pct > 50 ? "yellow" : "gray"}>
                  [{bar}] {pct}%
                </Text>
              </>
            ) : null;
          })()}
        </Box>
      </Box>
    </Box>
  );
}
