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

/** Reset the AskUser callback to null — used in tests to exercise the fallback path. */
export function resetOnAskUser(): void {
  _onAskUser = null;
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
                  markdown: { type: "string", description: "Preview content shown in a monospace box when this option is focused. Use for ASCII mockups, code snippets, or diagrams that help users visually compare options. Supports multi-line text." },
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
      metadata: {
        type: "object",
        description: "Optional metadata for tracking and analytics purposes. Not displayed to user.",
        properties: {
          source: { type: "string", description: "Optional identifier for the source of this question (e.g., 'remember' for /remember command). Used for analytics tracking." },
        },
      },
      annotations: {
        type: "object",
        description: "Optional per-question annotations from the user. Not displayed to user.",
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
