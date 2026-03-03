import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import os from "os";

interface SessionEntry {
  id: string;
  updatedAt: string;
  model: string;
  cwd: string;
  messageCount: number;
  title?: string;
}

interface SessionSelectorProps {
  sessions: SessionEntry[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export function SessionSelector({ sessions, onSelect, onCancel }: SessionSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const entry = sessions[selectedIndex];
      if (entry) onSelect(entry.id);
      return;
    }
    if (key.escape) {
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
      <Text bold color="cyan">Sessões Recentes</Text>
      <Text dimColor>↑↓ navegar · Enter retomar · Esc fechar</Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => {
          const isSelected = i === selectedIndex;
          const date = s.updatedAt.slice(0, 16).replace("T", " ");
          const modelShort = s.model.split("-").slice(-2).join("-");
          const cwdShort = s.cwd.replace(os.homedir(), "~");
          const label = s.title ? s.title : cwdShort;
          return (
            <Box key={s.id}>
              <Text bold={isSelected} inverse={isSelected}>
                {`${isSelected ? "▶" : " "} ${date}  ${modelShort.padEnd(8)}  (${s.messageCount} msgs)  ${label}`}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
