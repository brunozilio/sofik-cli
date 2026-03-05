import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AskUserRequest } from "../tools/askUser.ts";

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
  const [otherText, setOtherText] = useState("");
  const [typingOther, setTypingOther] = useState(false);

  const currentQuestion = request.questions[questionIdx]!;
  const isMulti = currentQuestion.multiSelect ?? false;
  const hasPreview = !isMulti && currentQuestion.options.some((o) => o.markdown);
  const focusedOption = currentQuestion.options[selectedIdx];
  const isLast = questionIdx === request.questions.length - 1;

  // Real options + virtual "Other" appended
  const totalOptions = currentQuestion.options.length + 1;
  const otherIdx = currentQuestion.options.length;
  const isOtherFocused = selectedIdx === otherIdx;

  useInput((input, key) => {
    if (typingOther) {
      if (key.return) {
        if (!otherText.trim()) return;
        submitAnswer(otherText.trim());
      } else if (key.escape) {
        setTypingOther(false);
        setOtherText("");
      } else if (key.backspace || key.delete) {
        setOtherText((t) => t.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setOtherText((t) => t + input);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => Math.min(totalOptions - 1, i + 1));
    } else if (input === " " && isMulti && !isOtherFocused) {
      setSelectedMulti((prev) => {
        const next = new Set(prev);
        if (next.has(selectedIdx)) next.delete(selectedIdx);
        else next.add(selectedIdx);
        return next;
      });
    } else if (key.return) {
      if (isOtherFocused) {
        setTypingOther(true);
        return;
      }
      if (isMulti) {
        if (selectedMulti.size === 0) return;
        const answer = [...selectedMulti]
          .sort()
          .map((i) => currentQuestion.options[i]!.label)
          .join(", ");
        submitAnswer(answer);
      } else {
        submitAnswer(currentQuestion.options[selectedIdx]!.label);
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  function submitAnswer(answer: string) {
    const newAnswers = { ...answers, [currentQuestion.question]: answer };
    setAnswers(newAnswers);
    if (isLast) {
      onComplete(newAnswers);
    } else {
      setQuestionIdx((i) => i + 1);
      setSelectedIdx(0);
      setSelectedMulti(new Set());
      setTypingOther(false);
      setOtherText("");
    }
  }

  const optionsList = (
    <Box flexDirection="column" marginTop={1}>
      {currentQuestion.options.map((option, i) => {
        const isSelected = isMulti ? selectedMulti.has(i) : i === selectedIdx;
        const isFocused = i === selectedIdx && !typingOther;
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

      {/* Other option — inline input when typing */}
      <Box flexDirection="row">
        <Text color={isOtherFocused && !typingOther ? "cyan" : "gray"}>
          {isOtherFocused && !typingOther ? "▶ " : "  "}
        </Text>
        {isMulti ? (
          <Text color="gray">{"[ ] "}</Text>
        ) : (
          <Text color={isOtherFocused ? "green" : "gray"}>
            {isOtherFocused ? "● " : "○ "}
          </Text>
        )}
        {typingOther ? (
          <Box flexDirection="row">
            <Text dimColor>Other: </Text>
            <Text>{otherText}</Text>
            <Text color="cyan">█</Text>
          </Box>
        ) : (
          <Text dimColor={!isOtherFocused} bold={isOtherFocused && !typingOther}>Other…</Text>
        )}
      </Box>
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
            {!typingOther && focusedOption?.markdown ? (
              <Box borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
                <Text>{focusedOption.markdown}</Text>
              </Box>
            ) : (
              <Box borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
                <Text dimColor>{typingOther ? "Digite e pressione Enter" : "(no preview)"}</Text>
              </Box>
            )}
            {!typingOther && focusedOption?.description && (
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
          {typingOther
            ? "Enter confirmar · Esc voltar"
            : `↑↓ navegar · Enter ${isLast ? "confirmar" : "próxima"} · Esc cancelar${isMulti ? " · Espaço selecionar" : ""}`}
        </Text>
      </Box>
    </Box>
  );
}
