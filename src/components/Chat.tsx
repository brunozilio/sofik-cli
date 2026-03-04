import React from "react";
import { Box, Text } from "ink";
import type { Message, LocalContentBlock, TurnEvent } from "../lib/types.ts";
import { Markdown } from "./Markdown.tsx";

interface ChatProps {
  messages: Message[];
  turnEvents: TurnEvent[];
  status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatToolArgs(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  const primaryKeys: Record<string, string> = {
    Read: "file_path",
    Write: "file_path",
    Edit: "file_path",
    MultiEdit: "file_path",
    Glob: "pattern",
    Grep: "pattern",
    Bash: "command",
    WebFetch: "url",
    WebSearch: "query",
    Agent: "prompt",
  };

  const key = primaryKeys[name];
  if (key && obj[key] != null) {
    const val = String(obj[key]);
    const truncated = val.length > 55 ? val.slice(0, 52) + "…" : val;
    return `("${truncated}")`;
  }

  const keys = Object.keys(obj).slice(0, 1);
  if (keys.length === 0) return "";
  const k = keys[0]!;
  const v = String(obj[k]);
  const trunc = v.length > 50 ? v.slice(0, 47) + "…" : v;
  return `(${trunc})`;
}

function resultSummary(result: string): string {
  const lines = result.split("\n");
  if (lines.length > 5) return `${lines.length} lines`;
  const preview = result.slice(0, 80).replace(/\n/g, " ↩ ");
  return preview + (result.length > 80 ? "…" : "");
}

// ── Tool category colors ────────────────────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  Read: "blue", Write: "blue", Edit: "blue", MultiEdit: "blue",
  Glob: "blue", Grep: "blue", NotebookEdit: "blue", NotebookRead: "blue",
  WebFetch: "cyan", WebSearch: "cyan",
  Bash: "yellow", Git: "yellow",
  Agent: "magenta",
  IntegrationAction: "magenta", IntegrationList: "magenta",
};

function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? "green";
}

// ── Sub-components ─────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="green">❯</Text>
        <Text>{lines[0]}</Text>
      </Box>
      {lines.slice(1).map((line, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ToolUseBlock({ name, input, isRunning }: { name: string; input: unknown; isRunning?: boolean }) {
  const args = formatToolArgs(name, input);
  const color = toolColor(name);
  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text color={color} bold>⏺ </Text>
      <Text bold color={color}>{name}</Text>
      <Text dimColor>{args}</Text>
      {isRunning && <Text dimColor> …</Text>}
    </Box>
  );
}

function ToolResultBlock({
  result,
  is_error,
}: {
  result: string;
  is_error: boolean;
}) {
  // Diff format
  const diffMatch = result.match(/^([\s\S]*?)\n__DIFF__\n([\s\S]*?)\n__END_DIFF__$/);
  if (diffMatch && !is_error) {
    const header = diffMatch[1]!.trim();
    const diffContent = diffMatch[2]!;
    const diffLines = diffContent.split("\n");
    const added = diffLines.filter((l) => l.startsWith("+")).length;
    const removed = diffLines.filter((l) => l.startsWith("-")).length;
    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text dimColor>
          ⎿ {header}
          {added > 0 || removed > 0 ? (
            <Text>
              {"  "}
              <Text color="green">+{added}</Text>
              {" "}
              <Text color="red">-{removed}</Text>
            </Text>
          ) : null}
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          {diffLines.slice(0, 10).map((line, i) => (
            <Text
              key={i}
              color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined}
              dimColor={!line.startsWith("+") && !line.startsWith("-")}
            >
              {line}
            </Text>
          ))}
          {diffLines.length > 10 && (
            <Text dimColor>  … +{diffLines.length - 10} lines</Text>
          )}
        </Box>
      </Box>
    );
  }

  if (is_error) {
    const preview = result.slice(0, 120).replace(/\n/g, " ");
    return (
      <Box marginLeft={2} marginBottom={1}>
        <Text color="red">⎿ Error: {preview}{result.length > 120 ? "…" : ""}</Text>
      </Box>
    );
  }

  const summary = resultSummary(result);
  return (
    <Box marginLeft={2} marginBottom={1}>
      <Text dimColor>⎿ {summary}</Text>
    </Box>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function Chat({ messages, turnEvents, status }: ChatProps) {
  return (
    <Box flexDirection="column">
      {/* Message history */}
      {messages.map((msg, i) => {
        if (msg.role === "user" && typeof msg.content === "string") {
          return <UserMessage key={`msg-${i}`} content={msg.content} />;
        }
        if (msg.role === "assistant") {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : (msg.content as LocalContentBlock[])
                  .filter((b): b is Extract<LocalContentBlock, { type: "text" }> => b.type === "text")
                  .map((b) => b.text)
                  .join("\n\n");
          if (!text.trim()) return null;
          return (
            <Box key={`msg-${i}`} flexDirection="column" marginBottom={1}>
              <Markdown content={text} />
            </Box>
          );
        }
        return null;
      })}

      {/* Current turn: interleaved text + tool calls + results */}
      {turnEvents.length > 0 && (
        <Box flexDirection="column">
          {(() => {
            const nodes: React.ReactNode[] = [];
            let i = 0;
            while (i < turnEvents.length) {
              const event = turnEvents[i]!;

              if (event.type === "text" && event.text) {
                nodes.push(
                  <Box key={`te-${i}`} flexDirection="column" marginBottom={1}>
                    <Markdown content={event.text} />
                  </Box>
                );
                i++;
                continue;
              }

              if (event.type === "tool_use") {
                const nextEvent = turnEvents[i + 1];
                const isRunning = !nextEvent || nextEvent.type !== "tool_result";
                nodes.push(
                  <ToolUseBlock key={`te-${i}`} name={event.name!} input={event.input} isRunning={isRunning} />
                );
                i++;
                continue;
              }

              if (event.type === "tool_result") {
                nodes.push(
                  <ToolResultBlock key={`te-${i}`} result={event.result ?? ""} is_error={event.is_error ?? false} />
                );
                i++;
                continue;
              }

              i++;
            }
            return nodes;
          })()}
        </Box>
      )}

      {/* Status label (e.g. while streaming) */}
      {status ? (
        <Box marginTop={0}>
          <Text dimColor>{status}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
