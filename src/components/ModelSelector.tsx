import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MODELS, COPILOT_MODELS } from "../lib/models.ts";
import { loadToken, loadCopilotToken } from "../lib/oauth.ts";

export interface ModelEntry {
  provider: "anthropic" | "copilot";
  modelId: string;
  label: string;
}

function buildModelList(): ModelEntry[] {
  const entries: ModelEntry[] = [];

  const hasAnthropicToken = !!loadToken();
  if (hasAnthropicToken) {
    for (const [modelId, info] of Object.entries(MODELS)) {
      entries.push({ provider: "anthropic", modelId, label: info.label });
    }
  }

  const hasCopilot = !!loadCopilotToken();
  if (hasCopilot) {
    for (const [modelId, info] of Object.entries(COPILOT_MODELS)) {
      entries.push({ provider: "copilot", modelId, label: info.label });
    }
  }

  return entries;
}

interface ModelSelectorProps {
  currentModel: string;
  onSelect: (modelId: string) => void;
  onCancel: () => void;
}

export function ModelSelector({ currentModel, onSelect, onCancel }: ModelSelectorProps) {
  const entries = buildModelList();
  const initialIndex = Math.max(0, entries.findIndex((e) => e.modelId === currentModel));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(entries.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const entry = entries[selectedIndex];
      if (entry) onSelect(entry.modelId);
      return;
    }
    if (key.escape || input === "q") {
      onCancel();
    }
  });

  if (entries.length === 0) {
    return (
      <Box borderStyle="round" borderColor="red" paddingX={2} paddingY={1} marginY={1}>
        <Text color="red">Nenhum provedor conectado. Execute /login primeiro.</Text>
      </Box>
    );
  }

  const PROVIDER_LABEL: Record<string, string> = {
    anthropic: "anthropic",
    copilot: "copilot",
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="cyan">Selecionar Modelo</Text>
      <Text dimColor>↑↓ navegar · Enter selecionar · Esc cancelar</Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, i) => {
          const isSelected = i === selectedIndex;
          const isCurrent = entry.modelId === currentModel;
          const displayName = `${PROVIDER_LABEL[entry.provider]} - ${entry.modelId}`;
          return (
            <Box key={`${entry.provider}:${entry.modelId}`}>
              <Text bold={isSelected} inverse={isSelected}>
                {isSelected ? "▶ " : "  "}
                {displayName.padEnd(40)}
              </Text>
              <Text dimColor={!isSelected}>{` ${entry.label}`}</Text>
              {isCurrent && <Text color="green"> ✓</Text>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
