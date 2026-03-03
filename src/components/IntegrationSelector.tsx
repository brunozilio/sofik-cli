import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { getAllProviders, getConnector } from "../integrations/connectors/index.ts";
import { listConnectedProviders } from "../integrations/CredentialStore.ts";

interface IntegrationSelectorProps {
  onSelect: (provider: string) => void;
  onCancel: () => void;
}

export function IntegrationSelector({ onSelect, onCancel }: IntegrationSelectorProps) {
  const providers = getAllProviders();
  const connected = new Set(listConnectedProviders().map((c) => c.provider));
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(providers.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const provider = providers[selectedIndex];
      if (provider) onSelect(provider);
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
      <Text bold color="cyan">Integrações</Text>
      <Text dimColor>↑↓ navegar · Enter conectar/reconectar · Esc cancelar</Text>
      <Box flexDirection="column" marginTop={1}>
        {providers.map((provider, i) => {
          const connector = getConnector(provider);
          const name = connector?.definition.name ?? provider;
          const isConnected = connected.has(provider);
          const isSelected = i === selectedIndex;
          return (
            <Box key={provider}>
              <Text bold={isSelected} inverse={isSelected}>
                {isSelected ? "▶ " : "  "}
                {name.padEnd(20)}
              </Text>
              <Text dimColor={!isConnected} color={isConnected ? "green" : undefined}>
                {isConnected ? " ✓ conectado" : " ✗ não conectado"}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
