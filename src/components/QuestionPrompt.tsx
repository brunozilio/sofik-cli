import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Question, AskUserRequest } from "../tools/askUser.ts";

interface QuestionPromptProps {
  request: AskUserRequest;
  onComplete: (answers: Record<string, string>) => void;
  onCancel: () => void;
}

export function QuestionPrompt({ request, onComplete, onCancel }: QuestionPromptProps) {
  const [questionIdx, setQuestionIdx] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedMulti, setSelectedMulti] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const currentQuestion = request.questions[questionIdx]!;
  const isMulti = currentQuestion.multiSelect ?? false;
  const isLast = questionIdx === request.questions.length - 1;

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => Math.min(currentQuestion.options.length - 1, i + 1));
    } else if (input === " " && isMulti) {
      // Toggle selection for multi-select
      setSelectedMulti((prev) => {
        const next = new Set(prev);
        if (next.has(selectedIdx)) next.delete(selectedIdx);
        else next.add(selectedIdx);
        return next;
      });
    } else if (key.return) {
      // Record answer
      let answer: string;
      if (isMulti) {
        if (selectedMulti.size === 0) return; // require at least one selection
        answer = [...selectedMulti]
          .sort()
          .map((i) => currentQuestion.options[i]!.label)
          .join(", ");
      } else {
        answer = currentQuestion.options[selectedIdx]!.label;
      }

      const newAnswers = { ...answers, [currentQuestion.question]: answer };
      setAnswers(newAnswers);

      if (isLast) {
        onComplete(newAnswers);
      } else {
        setQuestionIdx((i) => i + 1);
        setSelectedIdx(0);
        setSelectedMulti(new Set());
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="cyan">
        Pergunta {questionIdx + 1}/{request.questions.length} — {currentQuestion.header}
      </Text>
      <Box marginTop={1}>
        <Text bold>{currentQuestion.question}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {currentQuestion.options.map((option, i) => {
          const isSelected = isMulti ? selectedMulti.has(i) : i === selectedIdx;
          const isFocused = i === selectedIdx;
          return (
            <Box key={i} flexDirection="row">
              <Text color={isFocused ? "cyan" : "gray"}>
                {isFocused ? "▶ " : "  "}
              </Text>
              {isMulti ? (
                <Text color={isSelected ? "green" : "gray"}>
                  {isSelected ? "[✓] " : "[ ] "}
                </Text>
              ) : (
                <Text color={isSelected ? "green" : "gray"}>
                  {isSelected ? "● " : "○ "}
                </Text>
              )}
              <Text bold={isFocused}>{option.label}</Text>
              {option.description && (
                <Text dimColor> — {option.description}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navegar · Enter {isLast ? "confirmar" : "próxima"} · Esc cancelar
          {isMulti ? " · Espaço selecionar" : ""}
        </Text>
      </Box>
    </Box>
  );
}
