import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export type LoginProvider = "anthropic" | "copilot";

interface Provider {
  id: LoginProvider;
  label: string;
  description: string;
}

const PROVIDERS: Provider[] = [
  { id: "anthropic",  label: "Anthropic",       description: "Entrar via claude.ai (OAuth)" },
  { id: "copilot",    label: "GitHub Copilot",   description: "Entrar via fluxo de dispositivo GitHub" },
];

interface LoginProviderSelectorProps {
  onSelect: (provider: LoginProvider) => void;
  onCancel: () => void;
}

export function LoginProviderSelector({ onSelect, onCancel }: LoginProviderSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
      return;
    }
    if (key.return) {
      onSelect(PROVIDERS[selectedIndex]!.id);
      return;
    }
    if (key.escape || input === "q") {
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
      <Text bold color="cyan">Selecionar Provedor de Login</Text>
      <Text dimColor>↑↓ navegar · Enter selecionar · Esc cancelar</Text>
      <Box flexDirection="column" marginTop={1}>
        {PROVIDERS.map((p, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={p.id}>
              <Text bold={isSelected} inverse={isSelected}>
                {isSelected ? "▶ " : "  "}
                {p.label.padEnd(20)}
              </Text>
              <Text dimColor={!isSelected}>{` ${p.description}`}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
