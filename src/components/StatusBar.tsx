import React from "react";
import { Box, Text, useStdout } from "ink";
import path from "path";

interface StatusBarProps {
  model: string;
  cwd: string;
}

export function StatusBar({ model, cwd }: StatusBarProps) {
  const { stdout } = useStdout();
  const termWidth = (stdout?.columns ?? 80) - 2;

  const cwdBase = path.basename(cwd) || cwd;
  const shortModel = model.replace(/^claude-/, "");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Text bold color="cyan">Sofik AI</Text>
        <Text dimColor>Seu assistente de IA</Text>
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap={1}>
          <Text bold color="cyan">✦</Text>
          <Text dimColor>{shortModel}</Text>
          <Text dimColor>│</Text>
          <Text bold color="cyan">{'#'}</Text>
          <Text dimColor>{cwdBase}</Text>
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(termWidth)}</Text>
    </Box>
  );
}
