import fs from "fs";
import path from "path";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";
import { setPermissionMode } from "../lib/permissions.ts";

// ─── Plan mode state ───────────────────────────────────────────────────────

export interface PlanApprovalRequest {
  planContent: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  resolve: (approved: boolean) => void;
}

let _onExitPlanMode: ((req: PlanApprovalRequest) => void) | null = null;

/**
 * Register a callback to be called when the AI calls ExitPlanMode.
 * The callback receives the plan details and a resolve function.
 * Call resolve(true) to approve and execute, resolve(false) to reject.
 */
export function onExitPlanMode(callback: (req: PlanApprovalRequest) => void): void {
  _onExitPlanMode = callback;
}

/** Reset the plan mode callback to null — used in tests to exercise the fallback path. */
export function resetOnExitPlanMode(): void {
  _onExitPlanMode = null;
}

// ─── Tools ─────────────────────────────────────────────────────────────────

export const enterPlanModeTool: ToolDefinition = {
  name: "EnterPlanMode",
  description:
    "Switch to plan mode to explore the codebase and design an implementation approach before " +
    "writing any code or making changes. In plan mode you can use Read, Glob, Grep, WebFetch, " +
    "WebSearch, and TaskCreate — but NOT Bash, Write, Edit, or other mutating tools. " +
    "Use this proactively for non-trivial implementation tasks. " +
    "When done planning, call ExitPlanMode to present the plan for user approval.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_input) {
    setPermissionMode("plan");
    logger.app.info("EnterPlanMode ativado");
    return `Modo de planejamento ativado. Você está agora em modo SOMENTE LEITURA.

OBRIGATÓRIO: Complete TODAS as 5 fases antes de chamar ExitPlanMode. NÃO pule fases.

1. EXPLORAR — Explore o código em profundidade. Use Read, Glob, Grep, WebFetch, WebSearch. Faça múltiplas buscas em paralelo. Leia os arquivos críticos. Entenda a arquitetura existente antes de projetar qualquer coisa.

2. PROJETAR — Considere 2–3 abordagens de implementação diferentes. Analise os trade-offs. Escolha a melhor e documente o raciocínio.

3. ESCLARECER — Se houver requisitos ambíguos ou precisar de informações do usuário, use AskUserQuestion AGORA, dentro do modo de planejamento. Faça TODAS as perguntas aqui. Após a aprovação do ExitPlanMode, execute sem fazer mais perguntas.

4. ESCREVER O PLANO — Escreva seu plano completo em .sofik/plan.md. Inclua: Contexto, Abordagem escolhida, Arquivos críticos a alterar, Implementação passo a passo e Etapas de verificação. Este arquivo é obrigatório.

5. ExitPlanMode — Chame SOMENTE após escrever o arquivo de plano. NÃO chame com um plano vazio ou trivial.

Ferramentas disponíveis: Read, Glob, Grep, WebFetch, WebSearch, TaskCreate, AskUserQuestion.
Ferramentas de mutação (Bash, Write, Edit, Git) estão DESABILITADAS até o usuário aprovar seu plano.

Comece pela fase 1: explore o código.`;
  },
};

export const exitPlanModeTool: ToolDefinition = {
  name: "ExitPlanMode",
  description:
    "Signal that you are done planning and ready for user approval. " +
    "Write your complete plan to the plan file first, then call this tool. " +
    "The user will review your plan and either approve (allowing execution) or reject it. " +
    "Include allowedPrompts to describe the categories of actions your plan requires.",
  input_schema: {
    type: "object",
    properties: {
      allowedPrompts: {
        type: "array",
        description:
          "List of action categories your implementation plan requires (shown to user for approval)",
        items: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "The tool name (e.g., 'Bash', 'Write', 'Edit')",
            },
            prompt: {
              type: "string",
              description:
                "Semantic description of the action (e.g., 'run tests', 'install dependencies')",
            },
          },
          required: ["tool", "prompt"],
        },
      },
    },
    required: [],
  },
  async execute(input) {
    const allowedPrompts = input["allowedPrompts"] as
      | Array<{ tool: string; prompt: string }>
      | undefined;

    // Try to read a plan file if it was written
    let planContent = "Plano pronto para revisão.";
    const planFileCandidates = [
      path.join(process.cwd(), ".sofik", "plan.md"),
      path.join(process.cwd(), "PLAN.md"),
    ];
    for (const p of planFileCandidates) {
      try {
        planContent = fs.readFileSync(p, "utf-8");
        break;
      } catch { /* continue */ }
    }

    // Rejeitar planos triviais/vazios — o modelo deve escrever um plano real primeiro
    const isDefaultContent = planContent === "Plano pronto para revisão.";
    if (isDefaultContent || planContent.trim().length < 100) {
      logger.app.warn("ExitPlanMode rejeitado — plano não escrito ou muito curto", { planLength: planContent.trim().length });
      return (
        "ERRO: Nenhum arquivo de plano encontrado ou o plano é muito curto. " +
        "Você deve escrever seu plano completo em .sofik/plan.md (ou PLAN.md) antes de chamar ExitPlanMode. " +
        "Volte à fase 4 e escreva o plano primeiro, depois chame ExitPlanMode novamente."
      );
    }

    if (_onExitPlanMode) {
      logger.app.info("ExitPlanMode solicitado", { planLength: planContent.length, allowedPromptsCount: allowedPrompts?.length ?? 0 });
      // Trigger UI approval flow
      const approved = await new Promise<boolean>((resolve) => {
        _onExitPlanMode!({ planContent, allowedPrompts, resolve });
      });

      if (!approved) {
        logger.app.info("ExitPlanMode rejeitado pelo usuário");
        return "Plano rejeitado pelo usuário. Por favor, revise sua abordagem e tente novamente.";
      }
      logger.app.info("ExitPlanMode aprovado pelo usuário");
      setPermissionMode("ask");
      return (
        "Plano aprovado! Você pode prosseguir com a implementação. " +
        "Ferramentas de mutação (Bash, Write, Edit) estão disponíveis."
      );
    }

    // Fallback if no UI callback registered
    return (
      "Plano pronto. O usuário deve revisar e aprovar antes de prosseguir.\n\n" +
      (allowedPrompts?.length
        ? `Permissões necessárias:\n${allowedPrompts.map((p) => `  - ${p.tool}: ${p.prompt}`).join("\n")}`
        : "")
    );
  },
};
