import React from "react";
import { Box, Text, useInput } from "ink";
import fs from "fs";
import path from "path";
import { DiffView } from "./DiffView";

interface PermissionPromptProps {
  toolName: string;
  input: Record<string, unknown>;
  onApprove: () => void;
  onApproveAll: () => void;
  onDeny: () => void;
}

// Generate preview based on tool type
function renderPreview(toolName: string, input: Record<string, unknown>): React.ReactNode {
  if (toolName === "Edit") {
    const filePath = input["file_path"] as string | undefined;
    const oldString = input["old_string"] as string | undefined;
    const newString = input["new_string"] as string | undefined;

    if (filePath && oldString !== undefined && newString !== undefined) {
      try {
        const current = fs.readFileSync(path.resolve(filePath), "utf-8");
        const updated = current.replace(oldString, newString);
        return <DiffView oldContent={current} newContent={updated} />;
      } catch {
        // File not readable, fall through to default
      }
    }
  }

  if (toolName === "Write") {
    const filePath = input["file_path"] as string | undefined;
    const content = input["content"] as string | undefined;

    if (filePath && content !== undefined) {
      let oldContent = "";
      try {
        oldContent = fs.readFileSync(path.resolve(filePath), "utf-8");
      } catch {
        // New file — empty oldContent gives all-added diff
      }
      return <DiffView oldContent={oldContent} newContent={content} />;
    }
  }

  // Default: show parameters
  const preview = Object.entries(input)
    .map(([k, v]) => `  ${k}: ${String(v).slice(0, 120)}`)
    .join("\n");
  return <Text dimColor>{preview}</Text>;
}

export function PermissionPrompt({
  toolName,
  input,
  onApprove,
  onApproveAll,
  onDeny,
}: PermissionPromptProps) {
  useInput((char, key) => {
    if (key.escape || char === "n" || char === "N") onDeny();
    else if (char === "y" || char === "Y") onApprove();
    else if (char === "a" || char === "A") onApproveAll();
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Text bold color="yellow">
        ⚠ Permissão necessária: {toolName}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {renderPreview(toolName, input)}
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color="green" bold>
            y
          </Text>
          <Text> aprovar  </Text>
          <Text color="cyan" bold>
            a
          </Text>
          <Text> aprovar tudo (modo auto)  </Text>
          <Text color="red" bold>
            n
          </Text>
          <Text> / Esc negar</Text>
        </Text>
      </Box>
    </Box>
  );
}
