import type { ToolDefinition } from "../lib/types.ts";
import type { Message } from "../lib/types.ts";
import { buildSystemPrompt } from "../lib/systemPrompt.ts";
import { loadProjectMemory } from "../lib/session.ts";
import { getAllTools } from "./index.ts";
import { getActiveTasks } from "./task.ts";
import { getCurrentModel } from "../lib/anthropic.ts";
import { streamResponse } from "../lib/providers/index.ts";
import { logger } from "../lib/logger.ts";
import { randomBytes } from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// ── Agent IDs ─────────────────────────────────────────────────────────────────

function generateAgentId(): string {
  return `a${randomBytes(8).toString("hex")}`;
}

function getOutputPath(agentId: string): string {
  return path.join(os.homedir(), ".sofik", "agent-output", `${agentId}.output`);
}

function getTranscriptPath(agentId: string): string {
  return path.join(os.homedir(), ".sofik", "agent-transcripts", `${agentId}.json`);
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// ── Agent Registry ────────────────────────────────────────────────────────────

export interface AgentState {
  agentId: string;
  description: string;
  status: "running" | "completed" | "failed";
  output: string;
  outputFile: string;
  promise: Promise<string>;
  startedAt: number;
  endedAt?: number;
  transcriptFile?: string;
}

export const agentRegistry = new Map<string, AgentState>();

// ── Agent Type Definitions ────────────────────────────────────────────────────

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "TaskGet", "TaskList"];
const PLAN_TOOLS = [...READ_ONLY_TOOLS, "TaskCreate", "TaskUpdate", "AskUserQuestion"];

interface AgentTypeDefinition {
  description: string;
  tools: string[] | "all";
  model?: string;
  systemPromptSuffix: string;
}

export const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  "general-purpose": {
    description: "General-purpose agent for complex multi-step tasks",
    tools: "all",
    systemPromptSuffix: "",
  },
  "Explore": {
    description: "Fast exploration agent for reading and searching code",
    tools: READ_ONLY_TOOLS,
    model: "claude-haiku-4-5-20251001",
    systemPromptSuffix: "You are a fast exploration agent specialized for reading and searching codebases. Only read files — never write, edit, or execute code.",
  },
  "Plan": {
    description: "Planning agent for designing implementation strategies",
    tools: PLAN_TOOLS,
    systemPromptSuffix: "You are a planning agent. Explore the codebase and design implementation plans — never write or execute code. Return step-by-step plans and architectural analysis.",
  },
  "statusline-setup": {
    description: "Configure the user's Sofik status line setting",
    tools: ["Read", "Edit"],
    model: "claude-sonnet-4-6",
    systemPromptSuffix: "You are a specialized agent for configuring the Sofik status line. Read the user's settings file and make the requested configuration changes.",
  },
  "claude-code-guide": {
    description: "Answers questions about Sofik, Claude API, and Anthropic SDK",
    tools: [...READ_ONLY_TOOLS, "WebFetch", "WebSearch"],
    model: "claude-haiku-4-5-20251001",
    systemPromptSuffix: "You are an expert in Sofik AI, the Claude API, and the Anthropic SDK. Answer questions clearly and concisely, citing documentation when relevant. Only use read-only tools — never modify files.",
  },
};

// ── Transcript save/load ──────────────────────────────────────────────────────

function saveTranscript(agentId: string, messages: Message[]): void {
  try {
    const transcriptPath = getTranscriptPath(agentId);
    ensureDir(transcriptPath);
    fs.writeFileSync(transcriptPath, JSON.stringify(messages, null, 2), "utf8");
  } catch (err) {
    logger.tool.error("Falha ao salvar transcript do agente", { agentId, error: String(err) });
  }
}

function loadTranscript(agentId: string): Message[] | null {
  try {
    const transcriptPath = getTranscriptPath(agentId);
    if (!fs.existsSync(transcriptPath)) return null;
    const raw = fs.readFileSync(transcriptPath, "utf8");
    return JSON.parse(raw) as Message[];
  } catch {
    return null;
  }
}

// ── Core runner ───────────────────────────────────────────────────────────────

async function runAgent({
  agentId,
  description,
  prompt,
  systemPrompt,
  tools,
  model,
  maxTurns,
  resumeMessages,
  onChunk,
}: {
  agentId: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  model: string;
  maxTurns?: number;
  resumeMessages?: Message[];
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  const messages: Message[] = resumeMessages
    ? [...resumeMessages, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];

  const t0 = Date.now();
  logger.tool.info("Agente iniciado", { agentId, description, model, maxTurns, resuming: !!resumeMessages });

  let output = "";
  try {
    for await (const chunk of streamResponse({
      model,
      messages,
      tools,
      systemOverride: systemPrompt,
      maxTurns,
      onToolUse: async () => {},
      onToolResult: () => {},
    })) {
      output += chunk;
      onChunk?.(chunk);
    }

    logger.tool.info("Agente concluído", { agentId, description, durationMs: Date.now() - t0, outputLength: output.length });
    saveTranscript(agentId, messages);
  } catch (err) {
    logger.tool.error("Agente falhou", { agentId, description, error: String(err) });
    throw err;
  }

  return output || "(agente completou sem texto de saída)";
}

// ── Simple agent (for hooks) ──────────────────────────────────────────────────

export async function runSimpleAgent(opts: {
  prompt: string;
  model: string;
  toolNames: string[];
}): Promise<string> {
  const agentId = generateAgentId();
  const allTools = getAllTools().filter((t) => t.name !== "Agent");
  const tools = opts.toolNames.length === 0
    ? allTools
    : allTools.filter((t) => opts.toolNames.includes(t.name));
  const systemPrompt = buildSystemPrompt();
  return runAgent({
    agentId,
    description: "hook-agent",
    prompt: opts.prompt,
    systemPrompt,
    tools,
    model: opts.model,
  });
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const agentTool: ToolDefinition = {
  name: "Agent",
  description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, ExitPlanMode, Edit, Write, NotebookEdit)
- statusline-setup: Use this agent to configure the user's Sofik status line setting. (Tools: Read, Edit)
- claude-code-guide: Use this agent when the user asks questions ("Can Sofik...", "Does Sofik...", "How do I...") about Sofik AI features, the Claude API, or the Anthropic SDK. (Tools: Read-only + WebFetch, WebSearch)

When using the Agent tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Agent tool:
- If you want to read a specific file path, use the Read or Glob tool instead
- If you are searching for a specific class definition, use the Glob tool instead
- Other tasks that are not related to the agent descriptions above

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible by making multiple tool calls in one message
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes.
- Agents can be resumed using the \`resume\` parameter by passing the agent ID from a previous invocation.`,
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "3-5 word summary of the agent's task",
      },
      prompt: {
        type: "string",
        description: "The full task description. Be specific and self-contained.",
      },
      subagent_type: {
        type: "string",
        description: "The type of specialized agent to use: 'general-purpose' (default), 'Explore', 'Plan', 'statusline-setup', or 'claude-code-guide'",
      },
      inherit_context: {
        type: "boolean",
        description: "When true, inject parent session context (project memory, active tasks) into the agent's system prompt",
      },
      run_in_background: {
        type: "boolean",
        description: "When true, spawn the agent in the background and return immediately with an agent ID. Use TaskOutput to retrieve results later.",
      },
      resume: {
        type: "string",
        description: "Agent ID to resume. The agent will continue from its previous transcript.",
      },
      max_turns: {
        type: "number",
        description: "Maximum number of agentic turns before stopping. Unlimited if omitted.",
      },
    },
    required: ["description", "prompt"],
  },
  async execute(input) {
    const prompt = input["prompt"] as string;
    const description = input["description"] as string;
    const inheritContext = input["inherit_context"] as boolean | undefined;
    const runInBackground = input["run_in_background"] as boolean | undefined;
    const resumeId = input["resume"] as string | undefined;
    const maxTurns = input["max_turns"] as number | undefined;
    const subagentType = (input["subagent_type"] as string | undefined) ?? "general-purpose";

    // Resolve agent type config
    const agentTypeDef = AGENT_TYPES[subagentType] ?? AGENT_TYPES["general-purpose"];

    // Build tool list for this agent type
    const allTools = getAllTools().filter((t) => t.name !== "Agent");
    const tools =
      agentTypeDef.tools === "all"
        ? allTools
        : allTools.filter((t) => (agentTypeDef.tools as string[]).includes(t.name));

    // Resolve model
    const model = agentTypeDef.model ?? getCurrentModel();

    // Build system prompt
    let systemPrompt = buildSystemPrompt();

    if (inheritContext) {
      const parts: string[] = [];
      const memory = loadProjectMemory();
      if (memory) parts.push(`Project memory:\n${memory}`);
      const activeTasks = getActiveTasks();
      if (activeTasks.length > 0) {
        parts.push(`Active tasks:\n${activeTasks.map(t => `- [${t.id}] ${t.subject} (${t.status})`).join("\n")}`);
      }
      if (parts.length > 0) {
        systemPrompt += `\n\n<parent_context>\n${parts.join("\n\n")}\n</parent_context>`;
      }
    }

    if (agentTypeDef.systemPromptSuffix) {
      systemPrompt += `\n\n${agentTypeDef.systemPromptSuffix}`;
    }

    systemPrompt += `\n\n<subagent_context>You are a subagent handling the task: "${description}". Complete it and return your findings.</subagent_context>`;

    // Load resume transcript if requested
    let resumeMessages: Message[] | undefined;
    if (resumeId) {
      resumeMessages = loadTranscript(resumeId) ?? undefined;
      if (!resumeMessages) {
        return `Error: No transcript found for agent ID "${resumeId}"`;
      }
    }

    const agentId = generateAgentId();
    const outputFile = getOutputPath(agentId);
    ensureDir(outputFile);

    if (runInBackground) {
      // Spawn and return immediately
      let accumulatedOutput = "";

      const promise = runAgent({
        agentId,
        description,
        prompt,
        systemPrompt,
        tools,
        model,
        maxTurns,
        resumeMessages,
        onChunk: (chunk) => {
          accumulatedOutput += chunk;
          try {
            fs.appendFileSync(outputFile, chunk, "utf8");
          } catch { /* ignore write errors */ }
        },
      }).then((result) => {
        accumulatedOutput = result;
        const state = agentRegistry.get(agentId);
        if (state) {
          state.status = "completed";
          state.output = result;
          state.endedAt = Date.now();
          state.transcriptFile = getTranscriptPath(agentId);
        }
        return result;
      }).catch((err) => {
        const state = agentRegistry.get(agentId);
        if (state) {
          state.status = "failed";
          state.output = `Error: ${err instanceof Error ? err.message : String(err)}`;
          state.endedAt = Date.now();
        }
        throw err;
      });

      const state: AgentState = {
        agentId,
        description,
        status: "running",
        output: "",
        outputFile,
        promise: promise.catch(() => accumulatedOutput),
        startedAt: Date.now(),
        transcriptFile: getTranscriptPath(agentId),
      };
      agentRegistry.set(agentId, state);

      return JSON.stringify({
        agentId,
        outputFile,
        status: "running",
        message: `Agent started in background. Use TaskOutput tool with task_id: "${agentId}" to retrieve results.`,
      });
    }

    // Foreground: run synchronously
    let accumulatedOutput = "";
    const promise = runAgent({
      agentId,
      description,
      prompt,
      systemPrompt,
      tools,
      model,
      maxTurns,
      resumeMessages,
      onChunk: (chunk) => {
        accumulatedOutput += chunk;
        try { fs.appendFileSync(outputFile, chunk, "utf8"); } catch { /* ignore */ }
      },
    });

    const state: AgentState = {
      agentId,
      description,
      status: "running",
      output: "",
      outputFile,
      promise: promise.catch(() => accumulatedOutput),
      startedAt: Date.now(),
      transcriptFile: getTranscriptPath(agentId),
    };
    agentRegistry.set(agentId, state);

    let output: string;
    try {
      output = await promise;
      state.status = "completed";
      state.output = output;
      state.endedAt = Date.now();
    } catch (err) {
      state.status = "failed";
      state.endedAt = Date.now();
      throw err;
    }

    return `${output}\n\nagentId: ${agentId}`;
  },
};
