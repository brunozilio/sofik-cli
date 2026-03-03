import React from "react";
import { Box, Text } from "ink";

interface DiffLine {
  type: "added" | "removed" | "context";
  content: string;
}

function computeDiff(oldLines: string[], newLines: string[], context = 3): DiffLine[] {
  // Simple line-by-line diff using LCS
  // For simplicity, use a direct comparison with context
  const result: DiffLine[] = [];

  // Find changed regions
  const changes: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];

  // Simple diff: find blocks where lines differ
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
    } else {
      const changeStart = { old: i, new: j };
      // Advance until lines match again
      let found = false;
      for (let lookahead = 1; lookahead <= 20 && !found; lookahead++) {
        for (let oi = i; oi <= i + lookahead && oi < oldLines.length + 1; oi++) {
          const ni = j + lookahead - (oi - i);
          if (ni >= 0 && ni < newLines.length && oi < oldLines.length && oldLines[oi] === newLines[ni]) {
            changes.push({ oldStart: changeStart.old, oldEnd: oi, newStart: changeStart.new, newEnd: ni });
            i = oi; j = ni;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        changes.push({ oldStart: i, oldEnd: oldLines.length, newStart: j, newEnd: newLines.length });
        i = oldLines.length; j = newLines.length;
      }
    }
  }

  if (changes.length === 0) {
    return [{ type: "context", content: "(no changes)" }];
  }

  // Build output with context
  let lastEnd = 0;
  for (const change of changes) {
    // Context before change
    const ctxStart = Math.max(lastEnd, change.oldStart - context);
    for (let k = ctxStart; k < change.oldStart; k++) {
      result.push({ type: "context", content: oldLines[k] ?? "" });
    }
    // Removed lines
    for (let k = change.oldStart; k < change.oldEnd; k++) {
      result.push({ type: "removed", content: oldLines[k] ?? "" });
    }
    // Added lines
    for (let k = change.newStart; k < change.newEnd; k++) {
      result.push({ type: "added", content: newLines[k] ?? "" });
    }
    lastEnd = change.oldEnd;
  }
  // Context after last change
  const lastChange = changes[changes.length - 1]!;
  for (let k = lastChange.oldEnd; k < Math.min(lastChange.oldEnd + context, oldLines.length); k++) {
    result.push({ type: "context", content: oldLines[k] ?? "" });
  }

  return result;
}

interface DiffViewProps {
  oldContent: string;
  newContent: string;
  maxLines?: number;
}

export function DiffView({ oldContent, newContent, maxLines = 20 }: DiffViewProps) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff = computeDiff(oldLines, newLines);

  const added = diff.filter(l => l.type === "added").length;
  const removed = diff.filter(l => l.type === "removed").length;

  const visible = diff.slice(0, maxLines);
  const hidden = diff.length - visible.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Diff: <Text color="green">+{added}</Text> <Text color="red">-{removed}</Text>
      </Text>
      <Box flexDirection="column" marginLeft={1}>
        {visible.map((line, i) => (
          <Text
            key={i}
            color={line.type === "added" ? "green" : line.type === "removed" ? "red" : undefined}
            dimColor={line.type === "context"}
          >
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
            {line.content.slice(0, 100)}
          </Text>
        ))}
        {hidden > 0 && <Text dimColor>  ... +{hidden} more lines</Text>}
      </Box>
    </Box>
  );
}
