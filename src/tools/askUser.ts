import type { ToolDefinition } from "../lib/types.ts";

export interface QuestionOption {
  label: string;
  description?: string;
  markdown?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserRequest {
  questions: Question[];
  resolve: (answers: Record<string, string>) => void;
}

let _onAskUser: ((req: AskUserRequest) => void) | null = null;

/**
 * Register the UI callback for AskUserQuestion.
 * Called by App.tsx to intercept question prompts.
 */
export function onAskUser(callback: (req: AskUserRequest) => void): void {
  _onAskUser = callback;
}

export const askUserQuestionTool: ToolDefinition = {
  name: "AskUserQuestion",
  description:
    "Present a structured question to the user with labeled options and wait for their response. " +
    "Use this when you need user input before proceeding — for clarifying ambiguous requirements, " +
    "choosing between approaches, or gathering user preferences. " +
    "Supports single-select (radio) and multi-select (checkbox) questions. " +
    "For simple yes/no questions, prefer AskUserQuestion with two options over free-form text.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "List of questions to ask (1-4 questions)",
        items: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question text",
            },
            header: {
              type: "string",
              description: "Short label (max 12 chars) shown as a chip/tag",
            },
            options: {
              type: "array",
              description: "Available choices (2-4 options)",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Option display text" },
                  description: { type: "string", description: "Option explanation" },
                },
                required: ["label"],
              },
              minItems: 2,
              maxItems: 4,
            },
            multiSelect: {
              type: "boolean",
              description: "Allow multiple selections (default: false)",
            },
          },
          required: ["question", "header", "options"],
        },
        minItems: 1,
        maxItems: 4,
      },
      annotations: {
        type: "object",
        description: "Optional metadata (ignored)",
      },
      answers: {
        type: "object",
        description: "Pre-filled answers (ignored at runtime)",
      },
    },
    required: ["questions"],
  },
  async execute(input) {
    const questions = input["questions"] as Question[];

    if (!_onAskUser) {
      // Fallback: no UI — return the questions as text for the user to answer
      return (
        "Por favor, responda o seguinte:\n\n" +
        questions
          .map(
            (q, i) =>
              `${i + 1}. ${q.question}\n` +
              q.options.map((o, j) => `   ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`).join("\n")
          )
          .join("\n\n") +
        "\n\n(Sem interface interativa disponível — o usuário deve responder manualmente)"
      );
    }

    const answers = await new Promise<Record<string, string>>((resolve) => {
      _onAskUser!({ questions, resolve });
    });

    return (
      "Respostas do usuário:\n" +
      Object.entries(answers)
        .map(([q, a]) => `  ${q}: ${a}`)
        .join("\n")
    );
  },
};
