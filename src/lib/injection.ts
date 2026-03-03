/**
 * Prompt injection detection for tool results.
 *
 * Scans tool result content for patterns that could indicate an external
 * resource is attempting to hijack the agent's behavior.
 */

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\bignore\s+(previous|all|prior|above)\s+(instructions?|context|prompts?|rules?)/i,
    label: "instruction override attempt",
  },
  {
    pattern: /<\s*(system|SYSTEM)\s*>/,
    label: "fake system tag",
  },
  {
    pattern: /\[INST\]|\[\/INST\]/,
    label: "instruction bracket injection",
  },
  {
    pattern: /\bYou\s+are\s+now\s+(a|an)\s+\w.*\bAI\b/i,
    label: "persona reassignment",
  },
  {
    pattern: /\bForget\s+(everything|all)\s+(you('ve)?|I)\s+(know|said|told|wrote)/i,
    label: "memory wipe attempt",
  },
  {
    pattern: /\bDo\s+not\s+follow\s+(the|your)\s+(system|original|current)\s+(prompt|instructions?)/i,
    label: "system prompt override",
  },
  {
    pattern: /\bACTUAL\s+INSTRUCTIONS?\s*:/i,
    label: "actual instructions claim",
  },
  {
    pattern: /\bNew\s+instructions?\s*:\s*\n/i,
    label: "new instructions injection",
  },
  {
    pattern: /\bEND\s+OF\s+(CONTEXT|TASK|INSTRUCTIONS?)\b/i,
    label: "context termination attempt",
  },
  {
    pattern: /\bprint\s+(your|the)\s+system\s+prompt\b/i,
    label: "system prompt extraction attempt",
  },
];

/**
 * Check tool result content for signs of prompt injection.
 *
 * @returns A warning string if injection detected, null otherwise
 */
export function detectPromptInjection(content: string): string | null {
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      return `Possível injeção de prompt detectada no resultado da ferramenta (${label}). Revise o conteúdo antes de prosseguir.`;
    }
  }
  return null;
}
