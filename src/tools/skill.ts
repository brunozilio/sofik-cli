import type { ToolDefinition } from "../lib/types.ts";
import { getSkill, loadSkills } from "../lib/skills.ts";
import { logger } from "../lib/logger.ts";

export const skillTool: ToolDefinition = {
  name: "Skill",
  description:
    "Execute a skill (a named prompt template stored in .sofik/skills/ or ~/.sofik/skills/). " +
    "Skills provide specialized prompts for recurring tasks like code review, commit messages, etc. " +
    "When a user references a slash command like '/commit', it may map to a skill. " +
    "List available skills by calling with skill='list'.",
  input_schema: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description:
          "Name of the skill to execute, or 'list' to see all available skills",
      },
      args: {
        type: "string",
        description: "Optional arguments to pass to the skill (appended to the prompt)",
      },
    },
    required: ["skill"],
  },
  async execute(input) {
    const skillName = String(input["skill"] ?? "").trim();
    const args = String(input["args"] ?? "").trim();

    if (skillName === "list") {
      const skills = loadSkills();
      logger.tool.info("Skill list solicitado", { count: skills.length });
      if (skills.length === 0) {
        return (
          "Nenhuma habilidade encontrada. Crie arquivos .md em .sofik/skills/ (projeto) ou " +
          "~/.sofik/skills/ (usuário) para definir habilidades."
        );
      }
      return (
        `Habilidades disponíveis (${skills.length}):\n` +
        skills.map((s) => `  • ${s.name} — ${s.description}\n    (${s.source})`).join("\n")
      );
    }

    const skill = getSkill(skillName);
    if (!skill) {
      const skills = loadSkills();
      const names = skills.map((s) => s.name).join(", ");
      logger.tool.warn("Skill não encontrada", { skillName, available: names });
      return (
        `Habilidade '${skillName}' não encontrada.\n` +
        (names ? `Habilidades disponíveis: ${names}` : "Nenhuma habilidade está definida no momento.")
      );
    }

    logger.tool.info("Skill executada", { skillName, source: skill.source, hasArgs: !!args, contentLength: skill.content.length });

    // Return the skill content — the AI will use this as context/instructions
    const content = args ? `${skill.content}\n\n${args}` : skill.content;
    return (
      `Habilidade: ${skill.name}\nFonte: ${skill.source}\n\n` +
      `--- INÍCIO DA HABILIDADE ---\n${content}\n--- FIM DA HABILIDADE ---\n\n` +
      `Siga as instruções desta habilidade para concluir a tarefa.`
    );
  },
};
