import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import path from "path";
import { execSync } from "child_process";
import { loadSettings } from "../lib/settings.ts";

interface StatusBarProps {
  model: string;
  cwd: string;
}

function runStatusCommand(command: string): string | null {
  try {
    const result = execSync(command, { timeout: 500, stdio: ["ignore", "pipe", "ignore"] });
    return result.toString().trim().slice(0, 120);
  } catch {
    return null;
  }
}

export function StatusBar({ model, cwd }: StatusBarProps) {
  const { stdout } = useStdout();
  const termWidth = (stdout?.columns ?? 80) - 2;

  const cwdBase = path.basename(cwd) || cwd;
  const shortModel = model.replace(/^claude-/, "");

  const settings = loadSettings();
  const statusLineCmd = settings.statusLine?.command;

  const [customStatus, setCustomStatus] = useState<string | null>(
    statusLineCmd ? runStatusCommand(statusLineCmd) : null
  );

  useEffect(() => {
    if (!statusLineCmd) return;
    const interval = setInterval(() => {
      setCustomStatus(runStatusCommand(statusLineCmd));
    }, 1000);
    return () => clearInterval(interval);
  }, [statusLineCmd]);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={2} marginBottom={1}>
        <Text bold color="cyan">Sofik AI</Text>
        {customStatus ? (
          <Text dimColor>{customStatus}</Text>
        ) : (
          <Text dimColor>Seu assistente de IA</Text>
        )}
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
