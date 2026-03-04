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
  const hasPreview = !isMulti && currentQuestion.options.some((o) => o.markdown);
  const focusedOption = currentQuestion.options[selectedIdx];

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

  const optionsList = (
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
            {!hasPreview && option.description && (
              <Text dimColor> — {option.description}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );

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

      {hasPreview ? (
        <Box flexDirection="row" marginTop={1}>
          <Box flexDirection="column" flexShrink={0} width={28}>
            {optionsList}
          </Box>
          <Box flexDirection="column" marginLeft={2} flexGrow={1}>
            {focusedOption?.markdown ? (
              <Box borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
                <Text>{focusedOption.markdown}</Text>
              </Box>
            ) : (
              <Box borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
                <Text dimColor>(no preview)</Text>
              </Box>
            )}
            {focusedOption?.description && (
              <Box marginTop={1}>
                <Text dimColor>{focusedOption.description}</Text>
              </Box>
            )}
          </Box>
        </Box>
      ) : (
        optionsList
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ navegar · Enter {isLast ? "confirmar" : "próxima"} · Esc cancelar
          {isMulti ? " · Espaço selecionar" : ""}
        </Text>
      </Box>
    </Box>
  );
}
