import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { MODELS } from "../lib/models.ts";
import { loadSettings, saveProjectSettings } from "../lib/settings.ts";
import { getMcpStatus } from "../lib/mcp.ts";
import { getSessionUsage, estimateCost } from "../lib/anthropic.ts";

interface ConfigPanelProps {
  currentModel: string;
  onClose: () => void;
  onModelChange: (model: string) => void;
}

type Section = "general" | "mcp" | "session";

const MODEL_LIST = Object.keys(MODELS);

export function ConfigPanel({ currentModel, onClose, onModelChange }: ConfigPanelProps) {
  const [section, setSection] = useState<Section>("general");
  const [modelIdx, setModelIdx] = useState(() => Math.max(0, MODEL_LIST.indexOf(currentModel)));
  const settings = loadSettings();

  const sections: Section[] = ["general", "mcp", "session"];

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    // Tab to cycle sections
    if (key.tab) {
      const idx = sections.indexOf(section);
      setSection(sections[(idx + 1) % sections.length]!);
      return;
    }

    if (section === "general") {
      if (key.upArrow) {
        setModelIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setModelIdx((i) => Math.min(MODEL_LIST.length - 1, i + 1));
        return;
      }
      if (key.return || input === "s" || input === "S") {
        const newModel = MODEL_LIST[modelIdx];
        if (newModel) {
          onModelChange(newModel);
          saveProjectSettings({ model: newModel });
        }
        onClose();
        return;
      }
    }
  });

  const usage = getSessionUsage();
  const cost = estimateCost(currentModel, usage);
  const mcpStatuses = getMcpStatus();

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">⚙ Configurações</Text>
        <Text dimColor>ESC para fechar · Tab para navegar seções · S para salvar</Text>
      </Box>

      {/* Section tabs */}
      <Box flexDirection="row" gap={2} marginBottom={1}>
        {sections.map((s) => (
          <Text key={s} bold={section === s} color={section === s ? "cyan" : undefined} dimColor={section !== s}>
            {section === s ? `[${s}]` : ` ${s} `}
          </Text>
        ))}
      </Box>

      <Text dimColor>{"─".repeat(40)}</Text>

      {section === "general" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Modelo:</Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {MODEL_LIST.slice(Math.max(0, modelIdx - 3), modelIdx + 6).map((m, i) => {
              const actualIdx = Math.max(0, modelIdx - 3) + i;
              const isSelected = actualIdx === modelIdx;
              return (
                <Text key={m} bold={isSelected} inverse={isSelected} color={isSelected ? "cyan" : undefined}>
                  {isSelected ? "▶ " : "  "}{m}
                </Text>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑/↓ para navegar · Enter/S para salvar</Text>
          </Box>
          {settings.brevity && (
            <Box marginTop={1}>
              <Text dimColor>Brevidade: </Text>
              <Text>{settings.brevity}</Text>
            </Box>
          )}
        </Box>
      )}

      {section === "mcp" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Servidores MCP:</Text>
          {mcpStatuses.length === 0 ? (
            <Text dimColor marginLeft={2}>Nenhum servidor configurado</Text>
          ) : (
            <Box flexDirection="column" marginLeft={2} marginTop={1}>
              {mcpStatuses.map((s) => (
                <Box key={s.name} flexDirection="row" gap={1}>
                  <Text color={s.healthy ? "green" : "red"}>{s.healthy ? "✓" : "✗"}</Text>
                  <Text>{s.name}</Text>
                  <Text dimColor>{s.healthy ? "saudável" : "falhou"}</Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {section === "session" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Uso da Sessão:</Text>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            <Text dimColor>Input tokens:    <Text color="white">{usage.inputTokens.toLocaleString()}</Text></Text>
            <Text dimColor>Output tokens:   <Text color="white">{usage.outputTokens.toLocaleString()}</Text></Text>
            <Text dimColor>Cache read:      <Text color="white">{usage.cacheReadTokens.toLocaleString()}</Text></Text>
            <Text dimColor>Cache write:     <Text color="white">{usage.cacheWriteTokens.toLocaleString()}</Text></Text>
            <Text dimColor>Custo estimado:  <Text color="cyan">${cost.toFixed(6)}</Text></Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
