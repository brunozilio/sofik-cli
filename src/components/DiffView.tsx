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

// ── Word-level diff ────────────────────────────────────────────────────────

type WordToken = { type: "same" | "added" | "removed"; text: string };

export function computeWordDiff(oldLine: string, newLine: string): WordToken[] {
  // Tokenize by whitespace/punctuation boundaries
  const tokenize = (s: string): string[] => s.split(/(\s+|[.,;:!?()[\]{}"'])/);
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  // Simple LCS for tokens
  const m = oldTokens.length;
  const n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let ii = m - 1; ii >= 0; ii--) {
    for (let jj = n - 1; jj >= 0; jj--) {
      if (oldTokens[ii] === newTokens[jj]) {
        dp[ii]![jj] = 1 + (dp[ii + 1]?.[jj + 1] ?? 0);
      } else {
        dp[ii]![jj] = Math.max(dp[ii + 1]?.[jj] ?? 0, dp[ii]?.[jj + 1] ?? 0);
      }
    }
  }

  const result: WordToken[] = [];
  let ii = 0, jj = 0;
  while (ii < m || jj < n) {
    if (ii < m && jj < n && oldTokens[ii] === newTokens[jj]) {
      result.push({ type: "same", text: oldTokens[ii]! });
      ii++; jj++;
    } else if (jj < n && (ii >= m || (dp[ii]?.[jj + 1] ?? 0) >= (dp[ii + 1]?.[jj] ?? 0))) {
      result.push({ type: "added", text: newTokens[jj]! });
      jj++;
    } else {
      result.push({ type: "removed", text: oldTokens[ii]! });
      ii++;
    }
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

  // Pair up removed/added lines for word-level diff
  const pairedChanges: Array<{ removed?: string; added?: string }> = [];
  for (let idx = 0; idx < diff.length; idx++) {
    const line = diff[idx]!;
    if (line.type === "removed") {
      const next = diff[idx + 1];
      if (next?.type === "added") {
        pairedChanges.push({ removed: line.content, added: next.content });
      }
    }
  }
  const pairedRemovedSet = new Set(pairedChanges.map((p) => p.removed));
  const pairedAddedSet = new Set<string>();
  for (const p of pairedChanges) {
    if (p.removed && p.added) pairedAddedSet.add(p.added);
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Diff: <Text color="green">+{added}</Text> <Text color="red">-{removed}</Text>
      </Text>
      <Box flexDirection="column" marginLeft={1}>
        {visible.map((line, idx) => {
          // Word-level diff for paired removed/added lines
          if (line.type === "removed" && pairedRemovedSet.has(line.content)) {
            const pair = pairedChanges.find((p) => p.removed === line.content);
            if (pair?.added) {
              const tokens = computeWordDiff(line.content, pair.added);
              return (
                <Box key={idx} flexDirection="row">
                  <Text color="red">-</Text>
                  {tokens.filter((t) => t.type !== "added").map((t, ti) => (
                    <Text key={ti} color="red" bold={t.type === "removed"} dimColor={t.type === "same"}>
                      {t.text}
                    </Text>
                  ))}
                </Box>
              );
            }
          }
          if (line.type === "added" && pairedAddedSet.has(line.content)) {
            const pair = pairedChanges.find((p) => p.added === line.content);
            if (pair?.removed) {
              const tokens = computeWordDiff(pair.removed, line.content);
              return (
                <Box key={idx} flexDirection="row">
                  <Text color="green">+</Text>
                  {tokens.filter((t) => t.type !== "removed").map((t, ti) => (
                    <Text key={ti} color="green" bold={t.type === "added"} dimColor={t.type === "same"}>
                      {t.text}
                    </Text>
                  ))}
                </Box>
              );
            }
          }
          return (
            <Text
              key={idx}
              color={line.type === "added" ? "green" : line.type === "removed" ? "red" : undefined}
              dimColor={line.type === "context"}
            >
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              {line.content.slice(0, 100)}
            </Text>
          );
        })}
        {hidden > 0 && <Text dimColor>  ... +{hidden} more lines</Text>}
      </Box>
    </Box>
  );
}
